package kr.school.studentcall;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import android.graphics.drawable.GradientDrawable;

public class MainActivity extends Activity {
    private EditText serverUrl, deviceKey;
    private Spinner grade, classNo;
    private CheckBox autoStart, sound;
    private TextView status;
    private SharedPreferences prefs;

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = Prefs.get(this);
        setContentView(buildUi());
        load();
        updateStatus();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(48,36,48,48); root.setBackgroundColor(Color.rgb(243,245,248));
        scroll.addView(root);

        TextView title = text("학생 호출 수신기", 34, true); root.addView(title);
        TextView sub = text("이 전자칠판의 반을 한 번 등록하면 해당 반 호출만 표시됩니다.", 18, false); sub.setTextColor(Color.DKGRAY); sub.setPadding(0,4,0,22); root.addView(sub);

        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(28,24,28,28); card.setBackground(round(Color.WHITE, 22)); root.addView(card, new LinearLayout.LayoutParams(-1,-2));
        serverUrl = input(card,"웹앱 주소 (Apps Script 배포 URL)","https://script.google.com/macros/s/…/exec");
        LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); card.addView(row);
        grade = spinner(row,"학년",Prefs.MAX_GRADE); classNo = spinner(row,"반",Prefs.MAX_CLASS);
        deviceKey = input(card,"수신기 키","관리자에게 받은 DEVICE_KEY");
        autoStart = check(card,"전자칠판을 켜면 자동으로 호출 수신 시작");
        sound = check(card,"호출음 사용");

        Button save = button("설정 저장", Color.rgb(71,85,105)); card.addView(save); save.setOnClickListener(v -> { if(save()) toast("설정을 저장했습니다."); updateStatus(); });
        Button overlay = button("1. 다른 앱 위에 표시 권한 허용", Color.rgb(2,132,199)); card.addView(overlay); overlay.setOnClickListener(v -> requestOverlay());
        Button battery = button("2. 배터리 최적화 제외 (꺼짐 방지)", Color.rgb(2,132,199)); card.addView(battery); battery.setOnClickListener(v -> requestBatteryExemption());
        Button start = button("3. 호출 수신 시작", Color.rgb(29,78,216)); card.addView(start); start.setOnClickListener(v -> startReceiver());
        Button stop = button("호출 수신 중지", Color.rgb(185,28,28)); card.addView(stop); stop.setOnClickListener(v -> stopReceiver());
        Button test = button("테스트 팝업", Color.rgb(22,101,52)); card.addView(test); test.setOnClickListener(v -> testPopup());

        status = text("",18,true); status.setPadding(18,18,18,18); root.addView(status, new LinearLayout.LayoutParams(-1,-2));
        TextView foot = text("※ 알림 권한도 허용해 주세요. 운영 시간 밖에는 호출을 확인하지 않습니다.",14,false); foot.setTextColor(Color.GRAY); root.addView(foot);
        return scroll;
    }

    private LinearLayout field(LinearLayout parent,String label,boolean half){
        LinearLayout wrap=new LinearLayout(this);wrap.setOrientation(LinearLayout.VERTICAL);wrap.setPadding(0,8,half?10:0,8);
        wrap.addView(text(label,15,true));
        parent.addView(wrap, half?new LinearLayout.LayoutParams(0,-2,1):new LinearLayout.LayoutParams(-1,-2)); return wrap;
    }
    private EditText input(LinearLayout parent,String label,String hint){
        EditText e=new EditText(this);e.setTextSize(18);e.setHint(hint);e.setSingleLine(true);e.setPadding(16,12,16,12);e.setBackground(round(Color.rgb(245,247,250),12));
        field(parent,label,false).addView(e,new LinearLayout.LayoutParams(-1,58)); return e;
    }
    private Spinner spinner(LinearLayout parent,String label,int max){
        String[] items=new String[max];for(int i=0;i<max;i++)items[i]=String.valueOf(i+1);
        Spinner s=new Spinner(this);ArrayAdapter<String> a=new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,items);a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);s.setAdapter(a);s.setBackground(round(Color.rgb(245,247,250),12));
        field(parent,label,true).addView(s,new LinearLayout.LayoutParams(-1,58)); return s;
    }
    private CheckBox check(LinearLayout parent,String label){CheckBox c=new CheckBox(this);c.setText(label);c.setTextSize(17);c.setPadding(8,10,8,10);parent.addView(c);return c;}
    private TextView text(String s,int sp,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(Color.rgb(24,33,47));if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
    private Button button(String s,int color){Button b=new Button(this);b.setText(s);b.setTextSize(17);b.setTextColor(Color.WHITE);b.setAllCaps(false);b.setBackground(round(color,14));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,64);p.setMargins(0,9,0,0);b.setLayoutParams(p);return b;}
    private GradientDrawable round(int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(radius);return g;}

    private void load(){
        serverUrl.setText(prefs.getString(Prefs.SERVER_URL,""));
        grade.setSelection(Math.min(Prefs.number(prefs.getString(Prefs.GRADE,"1")),Prefs.MAX_GRADE)-1);
        classNo.setSelection(Math.min(Prefs.number(prefs.getString(Prefs.CLASS_NO,"1")),Prefs.MAX_CLASS)-1);
        deviceKey.setText(prefs.getString(Prefs.DEVICE_KEY,""));
        autoStart.setChecked(prefs.getBoolean(Prefs.AUTO_START,true));
        sound.setChecked(prefs.getBoolean(Prefs.SOUND,true));
    }
    private boolean save(){
        String url=serverUrl.getText().toString().trim();
        if(!url.isEmpty()&&!url.startsWith("https://")){toast("웹앱 주소는 https:// 로 시작해야 합니다. Apps Script 배포 화면의 웹 앱 URL을 그대로 붙여넣으세요.");return false;}
        String before=connectionSettings();
        prefs.edit().putString(Prefs.SERVER_URL,url)
                .putString(Prefs.GRADE,String.valueOf(grade.getSelectedItemPosition()+1))
                .putString(Prefs.CLASS_NO,String.valueOf(classNo.getSelectedItemPosition()+1))
                .putString(Prefs.DEVICE_KEY,deviceKey.getText().toString().trim())
                .putBoolean(Prefs.AUTO_START,autoStart.isChecked()).putBoolean(Prefs.SOUND,sound.isChecked()).apply();
        // 수신 중에 반이나 서버를 바꾸면 새 설정으로 다시 연결
        if(prefs.getBoolean(Prefs.ENABLED,false)&&!before.equals(connectionSettings())){stopService(new Intent(this,CallReceiverService.class));startService();}
        return true;
    }
    private String connectionSettings(){return prefs.getString(Prefs.SERVER_URL,"")+"|"+prefs.getString(Prefs.DEVICE_KEY,"")+"|"+Prefs.classId(this);}
    private void requestOverlay(){
        try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:"+getPackageName())));}
        catch(Exception e){
            try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));}
            catch(Exception e2){toast("설정 → 앱 → 특별한 앱 액세스 → 다른 앱 위에 표시에서 '학생 호출 수신기'를 허용해 주세요.");}
        }
    }
    private void requestBatteryExemption(){
        PowerManager pm=getSystemService(PowerManager.class);
        if(pm!=null&&pm.isIgnoringBatteryOptimizations(getPackageName())){toast("이미 배터리 최적화에서 제외되어 있습니다.");return;}
        try{startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:"+getPackageName())));}
        catch(Exception e){
            try{startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));}
            catch(Exception e2){toast("이 기기에서는 배터리 최적화 설정을 열 수 없습니다.");}
        }
    }
    private void startReceiver(){
        if(!save())return;
        if(prefs.getString(Prefs.SERVER_URL,"").isEmpty()||prefs.getString(Prefs.DEVICE_KEY,"").isEmpty()){toast("웹앱 주소와 수신기 키를 입력해 주세요.");return;}
        if(!Settings.canDrawOverlays(this)){toast("먼저 '다른 앱 위에 표시' 권한을 허용해 주세요.");requestOverlay();return;}
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},100);}
        prefs.edit().putBoolean(Prefs.ENABLED,true).apply();
        startService();
        toast("호출 수신을 시작했습니다.");updateStatus();
    }
    private void startService(){Intent i=new Intent(this,CallReceiverService.class);i.setAction(CallReceiverService.ACTION_START);startForegroundService(i);}
    private void stopReceiver(){prefs.edit().putBoolean(Prefs.ENABLED,false).apply();stopService(new Intent(this,CallReceiverService.class));toast("호출 수신을 중지했습니다.");updateStatus();}
    private void testPopup(){
        if(!Settings.canDrawOverlays(this)){toast("먼저 '다른 앱 위에 표시' 권한을 허용해 주세요.");requestOverlay();return;}
        save();Intent i=new Intent(this,CallReceiverService.class);i.setAction(CallReceiverService.ACTION_TEST);startService(i);
    }
    private void updateStatus(){
        boolean overlay=Settings.canDrawOverlays(this);boolean on=prefs.getBoolean(Prefs.ENABLED,false);
        String hours=prefs.getString(Prefs.ACTIVE_START,ActiveHours.DEFAULT_START)+"~"+prefs.getString(Prefs.ACTIVE_END,ActiveHours.DEFAULT_END);
        status.setText("등록 반: "+Prefs.classId(this)+"   ·   수신: "+(on?"켜짐":"꺼짐")+"   ·   오버레이 권한: "+(overlay?"허용":"미허용")+"   ·   운영 시간: "+hours+"\n호출 수신 시작 후 상단 알림에 '연결됨 · 10초마다 확인'이 표시되면 정상입니다.");
        status.setBackground(round(overlay&&on?Color.rgb(236,253,245):Color.rgb(255,247,237),14));
    }
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
    @Override protected void onResume(){super.onResume();if(status!=null)updateStatus();}
}
