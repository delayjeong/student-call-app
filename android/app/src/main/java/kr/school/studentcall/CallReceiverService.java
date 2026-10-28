package kr.school.studentcall;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.*;
import android.provider.Settings;
import android.view.*;
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
    public static final String ACTION_TEST_NOTICE="kr.school.studentcall.TEST_NOTICE";
    private static final int NOTIFY_ID=1505;
    private static final String CHANNEL="student_call_receiver";
    private static final String ALERT_CHANNEL="student_call_alert";
    private volatile boolean running=false;
    private volatile HttpURLConnection current;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Set<String> pendingAcks=new LinkedHashSet<>();
    private String lastNotice="";
    private Speaker speaker;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Call> queue=new ArrayDeque<>();
    private WindowManager wm;private View overlay;private Call showingCall;private CallCard card;private int remaining;
    private final Runnable tick=this::onTick;

    @Override public void onCreate(){super.onCreate();createChannel();wm=(WindowManager)getSystemService(WINDOW_SERVICE);speaker=new Speaker(this);}

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&ACTION_TEST.equals(intent.getAction())){enqueue(new Call(null,"call","테스트 선생님","김민수","교무실",""));return START_NOT_STICKY;}
        if(intent!=null&&ACTION_TEST_NOTICE.equals(intent.getAction())){enqueue(new Call(null,"notice","테스트 선생님","","","전달사항 화면과 음성 안내 테스트입니다."));return START_NOT_STICKY;}
        startAsForeground();
        if(!Prefs.get(this).getBoolean(Prefs.ENABLED,false)){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;}
        if(!running){running=true;io.execute(this::pollLoop);}return START_STICKY;
    }

    private void startAsForeground(){Notification n=notification("학생 호출·전달 수신 중",Prefs.classId(this)+" 및 학년 전체 전달을 수신합니다.");if(Build.VERSION.SDK_INT>=34)startForeground(NOTIFY_ID,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);else startForeground(NOTIFY_ID,n);}
    private Notification notification(String title,String text){Intent open=new Intent(this,MainActivity.class);PendingIntent pi=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(text).setOngoing(true).setContentIntent(pi).build();}
    private void createChannel(){NotificationManager nm=getSystemService(NotificationManager.class);NotificationChannel c=new NotificationChannel(CHANNEL,"학생 호출·전달 수신 상태",NotificationManager.IMPORTANCE_LOW);c.setDescription("전자칠판 학생 호출·전달 수신 상태");nm.createNotificationChannel(c);NotificationChannel a=new NotificationChannel(ALERT_CHANNEL,"학생 호출·전달",NotificationManager.IMPORTANCE_HIGH);a.setDescription("오버레이 권한이 없을 때 호출·전달을 알림으로 표시");a.setSound(null,null);a.enableVibration(false);a.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);nm.createNotificationChannel(a);}

    private void pollLoop(){
        long after=-1;int failures=0;
        while(running){
            SharedPreferences p=Prefs.get(this);String base=p.getString(Prefs.SERVER_URL,"");String key=p.getString(Prefs.DEVICE_KEY,"");
            if(base.isEmpty()||key.isEmpty()){notice("웹앱 주소와 수신기 키를 설정해 주세요.");sleep(5000);continue;}
            String start=p.getString(Prefs.ACTIVE_START,ActiveHours.DEFAULT_START),end=p.getString(Prefs.ACTIVE_END,ActiveHours.DEFAULT_END);int now=ActiveHours.nowMinutes(System.currentTimeMillis());
            if(!ActiveHours.isActive(now,start,end)){notice("운영 시간 외 · "+start+"에 확인을 시작합니다");after=-1;sleep(Math.max(1,Math.min(10,ActiveHours.minutesUntilStart(now,start,end)))*60_000L);continue;}
            String[] acks;synchronized(pendingAcks){acks=pendingAcks.toArray(new String[0]);}
            HttpURLConnection c=null;
            try{
                String u=base+(base.contains("?")?"&":"?")+"action=poll&classId="+enc(Prefs.classId(this))+"&deviceId="+enc(Prefs.deviceId(this))+"&key="+enc(key)+"&after="+(after<0?"":String.valueOf(after))+"&acked="+enc(String.join(",",acks));
                c=(HttpURLConnection)new URL(u).openConnection();current=c;c.setConnectTimeout(10000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(true);
                int code=c.getResponseCode();if(code!=200)throw new IOException("HTTP "+code);String body=readAll(c.getInputStream());JSONObject j;try{j=new JSONObject(body);}catch(Exception e){throw new IOException("웹앱 주소를 확인해 주세요 (JSON 아님)");}
                if(!j.optBoolean("ok")){String err=j.optString("error");throw new IOException("invalid key".equals(err)?"수신기 키가 올바르지 않습니다":err);}
                synchronized(pendingAcks){for(String a:acks)pendingAcks.remove(a);}
                int pollSeconds=Math.max(3,Math.min(60,j.optInt("pollSeconds",10)));p.edit().putString(Prefs.ACTIVE_START,j.optString("activeStart",start)).putString(Prefs.ACTIVE_END,j.optString("activeEnd",end)).apply();
                if(after<0)after=j.optLong("lastId",0);
                JSONArray calls=j.optJSONArray("calls");
                for(int i=0;calls!=null&&i<calls.length();i++){
                    JSONObject o=calls.getJSONObject(i);long id=o.getLong("id");String target=o.optString("classId");
                    if(id<=after||!matchesTarget(target))continue;
                    after=id;enqueue(new Call(String.valueOf(id),o.optString("type","call"),o.optString("teacher"),o.optString("student"),o.optString("location"),o.optString("message")));
                }
                JSONArray cancelled=j.optJSONArray("cancelled");for(int i=0;cancelled!=null&&i<cancelled.length();i++)cancel(String.valueOf(cancelled.optLong(i)));
                failures=0;notice(Prefs.classId(this)+" 연결됨 · "+pollSeconds+"초마다 확인 ("+start+"~"+end+")");sleep(pollSeconds*1000L);
            }catch(Exception e){if(!running)break;failures++;notice("연결 실패 · "+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage())+" · 다시 시도 중");sleep(Math.min(60_000L,5_000L*failures));}
            finally{current=null;if(c!=null)c.disconnect();}
        }
    }

    private boolean matchesTarget(String target){String own=Prefs.classId(this);if(own.equals(target))return true;String grade=own.split("-")[0];return (grade+"-*").equals(target);}
    private static String readAll(InputStream in)throws IOException{try(BufferedReader br=new BufferedReader(new InputStreamReader(in,StandardCharsets.UTF_8))){StringBuilder sb=new StringBuilder();String line;while((line=br.readLine())!=null)sb.append(line).append('\n');return sb.toString();}}
    private String enc(String s)throws Exception{return URLEncoder.encode(s,"UTF-8");}
    private void notice(String text){if(text.equals(lastNotice))return;lastNotice=text;updateNotification(text);}
    private void updateNotification(String text){try{((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFY_ID,notification("학생 호출 수신기",text));}catch(Exception ignored){}}

    private void enqueue(Call c){main.post(()->{if(!Settings.canDrawOverlays(this)){notifyCall(c);return;}queue.add(c);if(showingCall==null)showNext();});}
    private void cancel(String id){main.post(()->{for(Iterator<Call>it=queue.iterator();it.hasNext();)if(id.equals(it.next().id))it.remove();if(showingCall!=null&&id.equals(showingCall.id))dismiss();getSystemService(NotificationManager.class).cancel(notifyId(id));if(speaker!=null)speaker.cancel(id);});}
    private void announce(Call c){SharedPreferences p=Prefs.get(this);if(speaker==null||!p.getBoolean(Prefs.VOICE,true))return;String spoken=c.isNotice()?Korean.noticeSpoken(c.teacher,c.message):Korean.spoken(c.teacher,c.student,c.location,p.getBoolean(Prefs.VOICE_HIDE_NAME,false));speaker.say(c.id,spoken);}
    private static int notifyId(String callId){if(callId==null)return 1999;try{return 2000+(int)(Long.parseLong(callId)%100000);}catch(NumberFormatException e){return 2000+(callId.hashCode()&0xffff);}}

    private void notifyCall(Call c){
        int id=notifyId(c.id);Intent i=new Intent(this,CallActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(CallActivity.EXTRA_TYPE,c.type).putExtra(CallActivity.EXTRA_TEACHER,c.teacher).putExtra(CallActivity.EXTRA_STUDENT,c.student).putExtra(CallActivity.EXTRA_LOCATION,c.location).putExtra(CallActivity.EXTRA_MESSAGE,c.message).putExtra(CallActivity.EXTRA_NOTIFY_ID,id);
        PendingIntent pi=PendingIntent.getActivity(this,id,i,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        String title,body;if(c.isNotice()){title="📢 전달사항";body=Korean.noticeSpoken(c.teacher,c.message);}else{title="🔔 "+c.student+" 학생 호출";body=c.teacher+" 선생님 호출 · "+c.location+Korean.directionParticle(c.location)+" 오세요";}
        Notification n=new Notification.Builder(this,ALERT_CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC).setContentIntent(pi).setFullScreenIntent(pi,true).setAutoCancel(true).setTimeoutAfter(5*60_000L).build();
        try{getSystemService(NotificationManager.class).notify(id,n);}catch(Exception e){return;}if(Prefs.get(this).getBoolean(Prefs.SOUND,true))beep();announce(c);if(c.id!=null)synchronized(pendingAcks){pendingAcks.add(c.id);}if(!running)main.postDelayed(()->{if(!running&&showingCall==null)stopSelf();},25_000);
    }

    private void showNext(){removeOverlay();showingCall=null;if(queue.isEmpty()){if(!running)stopSelf();return;}if(!Settings.canDrawOverlays(this)){while(!queue.isEmpty())notifyCall(queue.poll());return;}Call c=queue.poll();card=new CallCard(this,c.type,c.teacher,c.student,c.location,c.message,this::dismiss);View box=card.root;remaining=CallCard.SHOW_SECONDS;updateCountdown();WindowManager.LayoutParams lp=new WindowManager.LayoutParams((int)(getResources().getDisplayMetrics().widthPixels*0.72),WindowManager.LayoutParams.WRAP_CONTENT,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);lp.gravity=Gravity.CENTER;try{wm.addView(box,lp);}catch(Exception e){card=null;notifyCall(c);showNext();return;}overlay=box;showingCall=c;if(Prefs.get(this).getBoolean(Prefs.SOUND,true))beep();announce(c);if(c.id!=null)synchronized(pendingAcks){pendingAcks.add(c.id);}main.postDelayed(tick,1000);}
    private void onTick(){if(showingCall==null)return;remaining--;if(remaining<=0){dismiss();return;}updateCountdown();main.postDelayed(tick,1000);}
    private void updateCountdown(){if(card!=null)card.setRemaining(remaining);}
    private void dismiss(){main.removeCallbacks(tick);showNext();}
    private void beep(){try{ToneGenerator tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,80);tone.startTone(ToneGenerator.TONE_PROP_BEEP2,500);main.postDelayed(tone::release,800);}catch(Exception ignored){}}
    private void removeOverlay(){if(overlay!=null){try{wm.removeView(overlay);}catch(Exception ignored){}overlay=null;card=null;}}
    private void sleep(long ms){try{Thread.sleep(ms);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}}
    @Override public void onDestroy(){running=false;HttpURLConnection c=current;if(c!=null)new Thread(c::disconnect).start();main.removeCallbacks(tick);queue.clear();removeOverlay();showingCall=null;if(speaker!=null){speaker.shutdown();speaker=null;}io.shutdownNow();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}

    static class Call{
        final String id,type,teacher,student,location,message;
        Call(String id,String type,String teacher,String student,String location,String message){this.id=id;this.type="notice".equals(type)?"notice":"call";this.teacher=teacher==null?"":teacher;this.student=student==null?"":student;this.location=location==null?"":location;this.message=message==null?"":message;}
        boolean isNotice(){return "notice".equals(type);}
    }
}
