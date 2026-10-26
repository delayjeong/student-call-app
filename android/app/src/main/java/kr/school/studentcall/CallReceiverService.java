package kr.school.studentcall;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CallReceiverService extends Service {
    public static final String ACTION_START="kr.school.studentcall.START";
    public static final String ACTION_TEST="kr.school.studentcall.TEST";
    private static final int NOTIFY_ID=1505;
    private static final int SHOW_SECONDS=15;
    private static final String CHANNEL="student_call_receiver";
    private volatile boolean running=false;
    private volatile HttpURLConnection current;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    /** 팝업을 표시한 호출 번호. 다음 확인 요청에 실어 보내고 성공하면 지운다. */
    private final Set<String> pendingAcks=new LinkedHashSet<>();
    private String lastNotice="";
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Call> queue=new ArrayDeque<>();
    private WindowManager wm; private View overlay; private Call showingCall; private TextView countdown; private int remaining;
    private final Runnable tick=this::onTick;

    @Override public void onCreate(){super.onCreate();createChannel();wm=(WindowManager)getSystemService(WINDOW_SERVICE);}

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null && ACTION_TEST.equals(intent.getAction())) {
            enqueue(new Call(null,"테스트 선생님","김민수","교무실"));
            return START_NOT_STICKY;
        }
        startAsForeground();
        // 시스템이 재시작시켰는데(intent==null) 사용자가 수신을 꺼둔 상태라면 바로 종료
        if(!Prefs.get(this).getBoolean(Prefs.ENABLED,false)){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;}
        if(!running){running=true;io.execute(this::pollLoop);} return START_STICKY;
    }

    private void startAsForeground(){Notification n=notification("학생 호출 수신 중", Prefs.classId(this)+" 호출만 수신합니다."); if(Build.VERSION.SDK_INT>=34) startForeground(NOTIFY_ID,n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING); else startForeground(NOTIFY_ID,n);}
    private Notification notification(String title,String text){Intent open=new Intent(this,MainActivity.class);PendingIntent pi=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(text).setOngoing(true).setContentIntent(pi).build();}
    private void createChannel(){NotificationChannel c=new NotificationChannel(CHANNEL,"학생 호출 수신",NotificationManager.IMPORTANCE_LOW);c.setDescription("전자칠판 학생 호출 수신 상태");getSystemService(NotificationManager.class).createNotificationChannel(c);}

    /**
     * Apps Script 웹앱에 주기적으로 새 호출을 묻는다.
     * 운영 시간 밖에는 요청하지 않고, 서버가 알려 주는 확인 간격·운영 시간을 따른다.
     */
    private void pollLoop(){
        long after=-1; // -1: 아직 기준 번호를 모름 (앱 시작 직후 / 운영 시간 시작)
        int failures=0;
        while(running){
            SharedPreferences p=Prefs.get(this);
            String base=p.getString(Prefs.SERVER_URL,"");String key=p.getString(Prefs.DEVICE_KEY,"");
            if(base.isEmpty()||key.isEmpty()){notice("웹앱 주소와 수신기 키를 설정해 주세요.");sleep(5000);continue;}
            String start=p.getString(Prefs.ACTIVE_START,ActiveHours.DEFAULT_START),end=p.getString(Prefs.ACTIVE_END,ActiveHours.DEFAULT_END);
            int now=ActiveHours.nowMinutes(System.currentTimeMillis());
            if(!ActiveHours.isActive(now,start,end)){
                notice("운영 시간 외 · "+start+"에 확인을 시작합니다");
                after=-1;
                // 시작 시각까지 기다리되, 기기 시계가 바뀌는 경우를 대비해 최대 10분마다 다시 확인
                sleep(Math.max(1,Math.min(10,ActiveHours.minutesUntilStart(now,start,end)))*60_000L);
                continue;
            }
            String[] acks;synchronized(pendingAcks){acks=pendingAcks.toArray(new String[0]);}
            HttpURLConnection c=null;
            try{
                String u=base+(base.contains("?")?"&":"?")+"action=poll&classId="+enc(Prefs.classId(this))+"&deviceId="+enc(Prefs.deviceId(this))
                        +"&key="+enc(key)+"&after="+(after<0?"":String.valueOf(after))+"&acked="+enc(String.join(",",acks));
                c=(HttpURLConnection)new URL(u).openConnection();current=c;
                c.setConnectTimeout(10000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(true);
                int code=c.getResponseCode();
                if(code!=200)throw new IOException("HTTP "+code);
                String body=readAll(c.getInputStream());
                JSONObject j;
                try{j=new JSONObject(body);}catch(Exception e){throw new IOException("웹앱 주소를 확인해 주세요 (JSON 아님)");}
                if(!j.optBoolean("ok")){
                    String err=j.optString("error");
                    throw new IOException("invalid key".equals(err)?"수신기 키가 올바르지 않습니다":err);
                }
                synchronized(pendingAcks){for(String a:acks)pendingAcks.remove(a);}
                int pollSeconds=Math.max(3,Math.min(60,j.optInt("pollSeconds",10)));
                p.edit().putString(Prefs.ACTIVE_START,j.optString("activeStart",start)).putString(Prefs.ACTIVE_END,j.optString("activeEnd",end)).apply();
                if(after<0)after=j.optLong("lastId",0);
                JSONArray calls=j.optJSONArray("calls");
                for(int i=0;calls!=null&&i<calls.length();i++){
                    JSONObject o=calls.getJSONObject(i);long id=o.getLong("id");
                    if(id<=after||!Prefs.classId(this).equals(o.optString("classId")))continue;
                    after=id;
                    enqueue(new Call(String.valueOf(id),o.optString("teacher"),o.optString("student"),o.optString("location")));
                }
                JSONArray cancelled=j.optJSONArray("cancelled");
                for(int i=0;cancelled!=null&&i<cancelled.length();i++)cancel(String.valueOf(cancelled.optLong(i)));
                failures=0;
                notice(Prefs.classId(this)+" 연결됨 · "+pollSeconds+"초마다 확인 ("+start+"~"+end+")");
                sleep(pollSeconds*1000L);
            }catch(Exception e){
                if(!running)break;
                failures++;
                notice("연결 실패 · "+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage())+" · 다시 시도 중");
                sleep(Math.min(60_000L,5_000L*failures));
            }finally{current=null;if(c!=null)c.disconnect();}
        }
    }
    private static String readAll(InputStream in)throws IOException{
        try(BufferedReader br=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){StringBuilder sb=new StringBuilder();String line;while((line=br.readLine())!=null)sb.append(line).append('\n');return sb.toString();}
    }
    private String enc(String s)throws Exception{return URLEncoder.encode(s,"UTF-8");}
    /** 같은 문구면 알림을 다시 갱신하지 않는다 (10초마다 알림이 깜빡이지 않도록). */
    private void notice(String text){if(text.equals(lastNotice))return;lastNotice=text;updateNotification(text);}
    private void updateNotification(String text){try{((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFY_ID,notification("학생 호출 수신기",text));}catch(Exception ignored){}}

    static String directionParticle(String location){if(location==null||location.isEmpty())return "로";char c=location.charAt(location.length()-1);if(c>=0xAC00&&c<=0xD7A3){int jong=(c-0xAC00)%28;return (jong==0||jong==8)?"로":"으로";}return "로";}

    private void enqueue(Call c){main.post(()->{queue.add(c);if(showingCall==null)showNext();});}
    private void cancel(String id){main.post(()->{
        for(Iterator<Call> it=queue.iterator();it.hasNext();)if(id.equals(it.next().id))it.remove();
        if(showingCall!=null&&id.equals(showingCall.id))dismiss();
    });}

    private void showNext(){
        removeOverlay();showingCall=null;
        // 수신을 켜지 않은 상태에서 테스트 팝업만 띄웠다면 표시가 끝난 뒤 서비스 종료
        if(queue.isEmpty()){if(!running)stopSelf();return;}
        if(!Settings.canDrawOverlays(this)){updateNotification("'다른 앱 위에 표시' 권한이 꺼져 있어 호출을 표시하지 못했습니다.");queue.clear();return;}
        Call c=queue.poll();
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setGravity(Gravity.CENTER);box.setPadding(60,44,60,36);GradientDrawable bg=new GradientDrawable();bg.setColor(Color.argb(248,255,255,255));bg.setCornerRadius(28);bg.setStroke(3,Color.rgb(29,78,216));box.setBackground(bg);
        box.addView(tv("🔔  학생 호출",30,true,Color.rgb(29,78,216)));addGap(box,18);
        box.addView(tv(c.teacher+" 선생님 호출",34,true,Color.rgb(30,41,59)));addGap(box,14);
        box.addView(tv(c.student+" 학생",48,true,Color.rgb(15,23,42)));addGap(box,12);
        box.addView(tv(c.location+directionParticle(c.location)+" 오세요",36,true,Color.rgb(185,28,28)));addGap(box,16);
        Button ok=new Button(this);ok.setText("확인");ok.setTextSize(22);ok.setTextColor(Color.WHITE);ok.setAllCaps(false);GradientDrawable okBg=new GradientDrawable();okBg.setColor(Color.rgb(29,78,216));okBg.setCornerRadius(16);ok.setBackground(okBg);ok.setPadding(80,10,80,10);ok.setOnClickListener(v->dismiss());box.addView(ok,new LinearLayout.LayoutParams(-2,-2));addGap(box,10);
        remaining=SHOW_SECONDS;countdown=tv("",18,false,Color.GRAY);box.addView(countdown);updateCountdown();
        WindowManager.LayoutParams lp=new WindowManager.LayoutParams((int)(getResources().getDisplayMetrics().widthPixels*0.72),WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);lp.gravity=Gravity.CENTER;
        try{wm.addView(box,lp);}catch(Exception e){showNext();return;}
        overlay=box;showingCall=c;
        if(Prefs.get(this).getBoolean(Prefs.SOUND,true))beep();
        if(c.id!=null)synchronized(pendingAcks){pendingAcks.add(c.id);}
        main.postDelayed(tick,1000);
    }
    private void onTick(){if(showingCall==null)return;remaining--;if(remaining<=0){dismiss();return;}updateCountdown();main.postDelayed(tick,1000);}
    private void updateCountdown(){if(countdown!=null)countdown.setText(remaining+"초 후 자동으로 닫힙니다.");}
    private void dismiss(){main.removeCallbacks(tick);showNext();}

    private void beep(){
        try{ToneGenerator tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,80);tone.startTone(ToneGenerator.TONE_PROP_BEEP2,500);main.postDelayed(tone::release,800);}catch(Exception ignored){}
    }

    private TextView tv(String s,int sp,boolean bold,int color){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(color);t.setGravity(Gravity.CENTER);if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
    private void addGap(LinearLayout p,int dp){Space x=new Space(this);p.addView(x,new LinearLayout.LayoutParams(1,(int)(dp*getResources().getDisplayMetrics().density)));}
    private void removeOverlay(){if(overlay!=null){try{wm.removeView(overlay);}catch(Exception ignored){}overlay=null;countdown=null;}}
    private void sleep(long ms){try{Thread.sleep(ms);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}}

    @Override public void onDestroy(){
        running=false;
        // 진행 중인 요청을 즉시 끊는다 (disconnect는 네트워크 작업이라 메인 스레드 밖에서)
        HttpURLConnection c=current;if(c!=null)new Thread(c::disconnect).start();
        main.removeCallbacks(tick);queue.clear();removeOverlay();showingCall=null;
        io.shutdownNow();super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
    static class Call{final String id,teacher,student,location;Call(String id,String t,String s,String l){this.id=id;teacher=t;student=s;location=l;}}
}
