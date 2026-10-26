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
    private static final String CHANNEL="student_call_receiver";
    /** '다른 앱 위에 표시' 권한이 없을 때 호출을 보여 주는 중요 알림 채널 (소리는 앱이 직접 낸다) */
    private static final String ALERT_CHANNEL="student_call_alert";
    private volatile boolean running=false;
    private volatile HttpURLConnection current;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    /** 팝업을 표시한 호출 번호. 다음 확인 요청에 실어 보내고 성공하면 지운다. */
    private final Set<String> pendingAcks=new LinkedHashSet<>();
    private String lastNotice="";
    private Speaker speaker;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Call> queue=new ArrayDeque<>();
    private WindowManager wm; private View overlay; private Call showingCall; private CallCard card; private int remaining;
    private final Runnable tick=this::onTick;

    @Override public void onCreate(){super.onCreate();createChannel();wm=(WindowManager)getSystemService(WINDOW_SERVICE);speaker=new Speaker(this);}

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
    private void createChannel(){
        NotificationManager nm=getSystemService(NotificationManager.class);
        NotificationChannel c=new NotificationChannel(CHANNEL,"학생 호출 수신 상태",NotificationManager.IMPORTANCE_LOW);c.setDescription("전자칠판 학생 호출 수신 상태");nm.createNotificationChannel(c);
        NotificationChannel a=new NotificationChannel(ALERT_CHANNEL,"학생 호출",NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("'다른 앱 위에 표시' 권한이 없을 때 호출을 알림으로 표시");a.setSound(null,null);a.enableVibration(false);a.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(a);
    }

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

    /**
     * 호출 표시. '다른 앱 위에 표시' 권한이 있으면 수업 화면 위 가운데 팝업(순서대로 한 건씩),
     * 없으면 중요 알림 + 전체 화면 알림으로 바로 보여 준다.
     */
    private void enqueue(Call c){main.post(()->{
        if(!Settings.canDrawOverlays(this)){notifyCall(c);return;}
        queue.add(c);if(showingCall==null)showNext();
    });}
    private void cancel(String id){main.post(()->{
        for(Iterator<Call> it=queue.iterator();it.hasNext();)if(id.equals(it.next().id))it.remove();
        if(showingCall!=null&&id.equals(showingCall.id))dismiss();
        getSystemService(NotificationManager.class).cancel(notifyId(id));
        if(speaker!=null)speaker.cancel(id);
    });}

    /** 음성 안내 (설정에서 켠 경우). TTS 엔진이 없으면 Speaker가 조용히 무시한다. */
    private void announce(Call c){
        SharedPreferences p=Prefs.get(this);
        if(speaker==null||!p.getBoolean(Prefs.VOICE,true))return;
        speaker.say(c.id,Korean.spoken(c.teacher,c.student,c.location,p.getBoolean(Prefs.VOICE_HIDE_NAME,false)));
    }

    private static int notifyId(String callId){
        if(callId==null)return 1999; // 테스트
        try{return 2000+(int)(Long.parseLong(callId)%100000);}catch(NumberFormatException e){return 2000+(callId.hashCode()&0xffff);}
    }

    /** 오버레이 권한이 없을 때: 화면 위쪽 중요 알림. 화면이 꺼져 있거나 잠겨 있으면 전체 화면 호출(CallActivity)이 뜬다. */
    private void notifyCall(Call c){
        int id=notifyId(c.id);
        Intent i=new Intent(this,CallActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(CallActivity.EXTRA_TEACHER,c.teacher).putExtra(CallActivity.EXTRA_STUDENT,c.student)
                .putExtra(CallActivity.EXTRA_LOCATION,c.location).putExtra(CallActivity.EXTRA_NOTIFY_ID,id);
        PendingIntent pi=PendingIntent.getActivity(this,id,i,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        String body=c.teacher+" 선생님 호출 · "+c.location+Korean.directionParticle(c.location)+" 오세요";
        Notification n=new Notification.Builder(this,ALERT_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("🔔 "+c.student+" 학생 호출").setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(pi).setFullScreenIntent(pi,true)
                .setAutoCancel(true).setTimeoutAfter(5*60_000L)
                .build();
        try{getSystemService(NotificationManager.class).notify(id,n);}catch(Exception e){return;}
        if(Prefs.get(this).getBoolean(Prefs.SOUND,true))beep();
        announce(c);
        if(c.id!=null)synchronized(pendingAcks){pendingAcks.add(c.id);}
        // 테스트 호출만 띄우려고 서비스를 잠깐 켠 경우: 음성 안내가 끝날 때쯤 종료
        if(!running)main.postDelayed(()->{if(!running&&showingCall==null)stopSelf();},25_000);
    }

    private void showNext(){
        removeOverlay();showingCall=null;
        // 수신을 켜지 않은 상태에서 테스트 팝업만 띄웠다면 표시가 끝난 뒤 서비스 종료
        if(queue.isEmpty()){if(!running)stopSelf();return;}
        // 표시 도중 권한이 꺼졌다면 남은 호출은 알림으로
        if(!Settings.canDrawOverlays(this)){while(!queue.isEmpty())notifyCall(queue.poll());return;}
        Call c=queue.poll();
        card=new CallCard(this,c.teacher,c.student,c.location,this::dismiss);
        View box=card.root;
        remaining=CallCard.SHOW_SECONDS;updateCountdown();
        WindowManager.LayoutParams lp=new WindowManager.LayoutParams((int)(getResources().getDisplayMetrics().widthPixels*0.72),WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);lp.gravity=Gravity.CENTER;
        try{wm.addView(box,lp);}catch(Exception e){card=null;notifyCall(c);showNext();return;}
        overlay=box;showingCall=c;
        if(Prefs.get(this).getBoolean(Prefs.SOUND,true))beep();
        announce(c);
        if(c.id!=null)synchronized(pendingAcks){pendingAcks.add(c.id);}
        main.postDelayed(tick,1000);
    }
    private void onTick(){if(showingCall==null)return;remaining--;if(remaining<=0){dismiss();return;}updateCountdown();main.postDelayed(tick,1000);}
    private void updateCountdown(){if(card!=null)card.setRemaining(remaining);}
    private void dismiss(){main.removeCallbacks(tick);showNext();}

    private void beep(){
        try{ToneGenerator tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,80);tone.startTone(ToneGenerator.TONE_PROP_BEEP2,500);main.postDelayed(tone::release,800);}catch(Exception ignored){}
    }

    private void removeOverlay(){if(overlay!=null){try{wm.removeView(overlay);}catch(Exception ignored){}overlay=null;card=null;}}
    private void sleep(long ms){try{Thread.sleep(ms);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}}

    @Override public void onDestroy(){
        running=false;
        // 진행 중인 요청을 즉시 끊는다 (disconnect는 네트워크 작업이라 메인 스레드 밖에서)
        HttpURLConnection c=current;if(c!=null)new Thread(c::disconnect).start();
        main.removeCallbacks(tick);queue.clear();removeOverlay();showingCall=null;
        if(speaker!=null){speaker.shutdown();speaker=null;}
        io.shutdownNow();super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
    static class Call{final String id,teacher,student,location;Call(String id,String t,String s,String l){this.id=id;teacher=t;student=s;location=l;}}
}
