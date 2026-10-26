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
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import android.graphics.drawable.GradientDrawable;

public class MainActivity extends Activity {
    private EditText serverUrl, grade, classNo, deviceKey;
    private TextView status;
    private SharedPreferences prefs;

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("student_call", MODE_PRIVATE);
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
        serverUrl = input(card,"서버 주소","http://192.168.1.10:8080");
        LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL); card.addView(row);
        grade = input(row,"학년","1",1); classNo = input(row,"반","5",1);
        deviceKey = input(card,"수신기 키","관리자에게 받은 DEVICE_KEY");

        Button save = button("설정 저장", Color.rgb(71,85,105)); card.addView(save); save.setOnClickListener(v -> { save(); toast("설정을 저장했습니다."); updateStatus(); });
        Button overlay = button("1. 다른 앱 위에 표시 권한 허용", Color.rgb(2,132,199)); card.addView(overlay); overlay.setOnClickListener(v -> requestOverlay());
        Button start = button("2. 호출 수신 시작", Color.rgb(29,78,216)); card.addView(start); start.setOnClickListener(v -> startReceiver());
        Button stop = button("호출 수신 중지", Color.rgb(185,28,28)); card.addView(stop); stop.setOnClickListener(v -> { stopService(new Intent(this, CallReceiverService.class)); updateStatus(); });
        Button test = button("테스트 팝업", Color.rgb(22,101,52)); card.addView(test); test.setOnClickListener(v -> { save(); Intent i=new Intent(this,CallReceiverService.class); i.setAction(CallReceiverService.ACTION_TEST); startService(i); });

        status = text("",18,true); status.setPadding(18,18,18,18); root.addView(status, new LinearLayout.LayoutParams(-1,-2));
        TextView foot = text("※ Android 13 이상에서는 알림 권한도 허용해 주세요. 운영 시에는 HTTPS 서버 사용을 권장합니다.",14,false); foot.setTextColor(Color.GRAY); root.addView(foot);
        return scroll;
    }

    private EditText input(LinearLayout parent,String label,String hint){ return input(parent,label,hint,0); }
    private EditText input(LinearLayout parent,String label,String hint,int weight){
        LinearLayout wrap=new LinearLayout(this);wrap.setOrientation(LinearLayout.VERTICAL);wrap.setPadding(0,8,weight>0?10:0,8);
        TextView l=text(label,15,true);wrap.addView(l);
        EditText e=new EditText(this);e.setTextSize(18);e.setHint(hint);e.setSingleLine(true);e.setPadding(16,12,16,12);e.setBackground(round(Color.rgb(245,247,250),12));wrap.addView(e,new LinearLayout.LayoutParams(-1,58));
        parent.addView(wrap, weight>0?new LinearLayout.LayoutParams(0,-2,weight):new LinearLayout.LayoutParams(-1,-2)); return e;
    }
    private TextView text(String s,int sp,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(Color.rgb(24,33,47));if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
    private Button button(String s,int color){Button b=new Button(this);b.setText(s);b.setTextSize(17);b.setTextColor(Color.WHITE);b.setAllCaps(false);b.setBackground(round(color,14));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,64);p.setMargins(0,9,0,0);b.setLayoutParams(p);return b;}
    private GradientDrawable round(int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(radius);return g;}

    private void load(){serverUrl.setText(prefs.getString("serverUrl",""));grade.setText(prefs.getString("grade","1"));classNo.setText(prefs.getString("classNo","1"));deviceKey.setText(prefs.getString("deviceKey",""));}
    private void save(){String url=serverUrl.getText().toString().trim().replaceAll("/+$","");prefs.edit().putString("serverUrl",url).putString("grade",grade.getText().toString().trim()).putString("classNo",classNo.getText().toString().trim()).putString("deviceKey",deviceKey.getText().toString()).apply();}
    private void requestOverlay(){Intent i=new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:"+getPackageName()));startActivity(i);}
    private void startReceiver(){save(); if(!Settings.canDrawOverlays(this)){toast("먼저 '다른 앱 위에 표시' 권한을 허용해 주세요.");requestOverlay();return;} if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},100);} Intent i=new Intent(this,CallReceiverService.class);i.setAction(CallReceiverService.ACTION_START);startForegroundService(i);toast("호출 수신을 시작했습니다.");updateStatus();}
    private void updateStatus(){boolean overlay=Settings.canDrawOverlays(this);String cid=prefs.getString("grade","?")+"-"+prefs.getString("classNo","?");status.setText("등록 반: "+cid+"   ·   오버레이 권한: "+(overlay?"허용":"미허용")+"\n호출 수신 시작 후 상단 알림에 '학생 호출 수신 중'이 표시되면 정상입니다.");status.setBackground(round(overlay?Color.rgb(236,253,245):Color.rgb(255,247,237),14));}
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_SHORT).show();}
    @Override protected void onResume(){super.onResume();if(status!=null)updateStatus();}
}
