package kr.school.studentcall;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.JSONObject;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CallReceiverService extends Service {
    public static final String ACTION_START="kr.school.studentcall.START";
    public static final String ACTION_TEST="kr.school.studentcall.TEST";
    private static final int NOTIFY_ID=1505;
    private static final String CHANNEL="student_call_receiver";
    private volatile boolean running=false;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ArrayDeque<Call> queue=new ArrayDeque<>();
    private WindowManager wm; private View overlay; private boolean showing=false;

    @Override public void onCreate(){super.onCreate();createChannel();wm=(WindowManager)getSystemService(WINDOW_SERVICE);}

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null && ACTION_TEST.equals(intent.getAction())) { enqueue(new Call("테스트 선생님","김민수","교무실")); return START_NOT_STICKY; }
        startAsForeground();
        if(!running){running=true;io.execute(this::connectionLoop);} return START_STICKY;
    }

    private void startAsForeground(){Notification n=notification("학생 호출 수신 중", classId()+" 호출만 수신합니다."); if(Build.VERSION.SDK_INT>=34) startForeground(NOTIFY_ID,n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING); else startForeground(NOTIFY_ID,n);}
    private Notification notification(String title,String text){Intent open=new Intent(this,MainActivity.class);PendingIntent pi=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(text).setOngoing(true).setContentIntent(pi).build();}
    private void createChannel(){if(Build.VERSION.SDK_INT>=26){NotificationChannel c=new NotificationChannel(CHANNEL,"학생 호출 수신",NotificationManager.IMPORTANCE_LOW);c.setDescription("전자칠판 학생 호출 수신 상태");getSystemService(NotificationManager.class).createNotificationChannel(c);}}

    private String classId(){SharedPreferences p=getSharedPreferences("student_call",MODE_PRIVATE);return p.getString("grade","1")+"-"+p.getString("classNo","1");}
    private String deviceId(){SharedPreferences p=getSharedPreferences("student_call",MODE_PRIVATE);String id=p.getString("deviceId","");if(id.isEmpty()){id= UUID.randomUUID().toString();p.edit().putString("deviceId",id).apply();}return id;}

    private void connectionLoop(){int wait=1000;while(running){HttpURLConnection c=null;try{SharedPreferences p=getSharedPreferences("student_call",MODE_PRIVATE);String base=p.getString("serverUrl","").replaceAll("/+$","");String key=p.getString("deviceKey","");if(base.isEmpty()||key.isEmpty()){sleep(3000);continue;}String u=base+"/api/stream?classId="+enc(classId())+"&deviceId="+enc(deviceId())+"&key="+enc(key);c=(HttpURLConnection)new URL(u).openConnection();c.setConnectTimeout(10000);c.setReadTimeout(30000);c.setRequestProperty("Accept","text/event-stream");c.setRequestProperty("Cache-Control","no-cache");int code=c.getResponseCode();if(code!=200){updateNotification("연결 실패 · HTTP "+code);throw new IOException("HTTP "+code);}updateNotification(classId()+" 연결됨 · 호출 대기 중");wait=1000;try(BufferedReader br=new BufferedReader(new InputStreamReader(c.getInputStream(),StandardCharsets.UTF_8))){String line;while(running && (line=br.readLine())!=null){if(line.startsWith("data: "))handleData(line.substring(6));}}}catch(Exception e){updateNotification("연결 재시도 중 · "+classId());sleep(wait);wait=Math.min(wait*2,15000);}finally{if(c!=null)c.disconnect();}}}
    private String enc(String s)throws Exception{return URLEncoder.encode(s,"UTF-8");}
    private void updateNotification(String text){try{((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFY_ID,notification("학생 호출 수신기",text));}catch(Exception ignored){}}
    private String directionParticle(String location){if(location==null||location.isEmpty())return "로";char c=location.charAt(location.length()-1);if(c>=0xAC00&&c<=0xD7A3){int jong=(c-0xAC00)%28;return (jong==0||jong==8)?"로":"으로";}return "로";}
    private void handleData(String raw){try{JSONObject j=new JSONObject(raw);if(!"call".equals(j.optString("type")))return;if(!classId().equals(j.optString("classId")))return;enqueue(new Call(j.optString("teacher"),j.optString("student"),j.optString("location")));}catch(Exception ignored){}}
    private void enqueue(Call c){main.post(()->{queue.add(c);if(!showing)showNext();});}

    private void showNext(){if(queue.isEmpty()){showing=false;return;} showing=true;Call c=queue.poll();if(!Settings.canDrawOverlays(this)){showing=false;return;} removeOverlay();
        LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setGravity(Gravity.CENTER);box.setPadding(60,44,60,44);GradientDrawable bg=new GradientDrawable();bg.setColor(Color.argb(248,255,255,255));bg.setCornerRadius(28);bg.setStroke(3,Color.rgb(29,78,216));box.setBackground(bg);
        TextView h=tv("🔔  학생 호출",30,true,Color.rgb(29,78,216));box.addView(h);addGap(box,18);
        TextView t=tv(c.teacher+" 선생님 호출",34,true,Color.rgb(30,41,59));box.addView(t);addGap(box,14);
        TextView s=tv(c.student+" 학생",48,true,Color.rgb(15,23,42));box.addView(s);addGap(box,12);
        TextView l=tv(c.location+directionParticle(c.location)+" 오세요",36,true,Color.rgb(185,28,28));box.addView(l);addGap(box,12);
        TextView f=tv("10초 후 자동으로 닫힙니다.",18,false,Color.GRAY);box.addView(f);
        int type=Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams lp=new WindowManager.LayoutParams((int)(getResources().getDisplayMetrics().widthPixels*0.72),WindowManager.LayoutParams.WRAP_CONTENT,type,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);lp.gravity=Gravity.CENTER;overlay=box;
        try{wm.addView(overlay,lp);ToneGenerator tone=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,75);tone.startTone(ToneGenerator.TONE_PROP_BEEP,350);main.postDelayed(tone::release,600);}catch(Exception e){overlay=null;showing=false;showNext();return;}
        main.postDelayed(()->{removeOverlay();showing=false;showNext();},10000);
    }
    private TextView tv(String s,int sp,boolean bold,int color){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(color);t.setGravity(Gravity.CENTER);if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
    private void addGap(LinearLayout p,int dp){Space x=new Space(this);p.addView(x,new LinearLayout.LayoutParams(1,(int)(dp*getResources().getDisplayMetrics().density)));}
    private void removeOverlay(){if(overlay!=null){try{wm.removeView(overlay);}catch(Exception ignored){}overlay=null;}}
    private void sleep(long ms){try{Thread.sleep(ms);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}}

    @Override public void onDestroy(){running=false;removeOverlay();io.shutdownNow();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
    static class Call{final String teacher,student,location;Call(String t,String s,String l){teacher=t;student=s;location=l;}}
}
