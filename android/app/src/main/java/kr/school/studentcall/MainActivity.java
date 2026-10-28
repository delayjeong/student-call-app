package kr.school.studentcall;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.*;

public class MainActivity extends Activity {
    private EditText serverUrl,deviceKey;
    private Spinner grade,classNo;
    private CheckBox autoStart,sound,voice,voiceHideName;
    private TextView status,connectionState;
    private LinearLayout connectionFields;
    private SharedPreferences prefs;
    private boolean loading=false;

    @Override public void onCreate(Bundle b){
        super.onCreate(b);prefs=Prefs.get(this);setContentView(buildUi());load();updateStatus();
        if(prefs.getBoolean(Prefs.OLD_SERVER_CLEARED,false)){
            prefs.edit().remove(Prefs.OLD_SERVER_CLEARED).apply();
            new android.app.AlertDialog.Builder(this).setTitle("연결 정보를 다시 입력해 주세요")
                    .setMessage("Google Apps Script 방식으로 변경되어 예전 연결 정보를 지웠습니다. 웹앱 주소와 수신기 키를 새로 저장해 주세요.")
                    .setPositiveButton("확인",null).show();
        }
    }

    private View buildUi(){
        ScrollView scroll=new ScrollView(this);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(48,36,48,48);root.setBackgroundColor(Color.rgb(243,245,248));scroll.addView(root);
        root.addView(text("학생 호출 수신기",34,true));
        TextView sub=text("이 전자칠판의 반을 등록하면 해당 반 호출과 학년 전체 전달사항을 받습니다.",18,false);sub.setTextColor(Color.DKGRAY);sub.setPadding(0,4,0,20);root.addView(sub);

        LinearLayout classCard=card(root,"전자칠판 등록");
        LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);classCard.addView(row);
        grade=spinner(row,"학년",new String[]{"1","2","3"});
        classNo=spinner(row,"반",new String[]{"1","2","3","4","5"});
        grade.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
            public void onItemSelected(AdapterView<?> p,View v,int pos,long id){if(!loading)rebuildClasses(pos+1,1);}public void onNothingSelected(AdapterView<?> p){}
        });
        autoStart=check(classCard,"전자칠판을 켜면 자동으로 수신 시작");
        sound=check(classCard,"호출·전달 알림음 사용");
        voice=check(classCard,"TTS 음성 안내 사용");
        voiceHideName=check(classCard,"학생 호출 TTS에서 학생 이름 숨기기");
        Button saveOptions=button("반·수신 설정 저장",Color.rgb(51,65,85));classCard.addView(saveOptions);saveOptions.setOnClickListener(v->{saveOptions();toast("반·수신 설정을 저장했습니다.");});

        LinearLayout connectionCard=card(root,"연결 정보");
        connectionState=text("",17,true);connectionState.setPadding(0,4,0,8);connectionCard.addView(connectionState);
        TextView secretInfo=text("저장된 웹앱 주소와 수신기 키는 다시 화면에 표시하지 않습니다.",14,false);secretInfo.setTextColor(Color.GRAY);connectionCard.addView(secretInfo);
        connectionFields=new LinearLayout(this);connectionFields.setOrientation(LinearLayout.VERTICAL);connectionCard.addView(connectionFields);
        serverUrl=input(connectionFields,"웹앱 주소","https://script.google.com/macros/s/…/exec");
        deviceKey=input(connectionFields,"수신기 키","관리자에게 받은 DEVICE_KEY");deviceKey.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        Button saveConnection=button("웹앱 주소·수신기 키 저장",Color.rgb(29,78,216));connectionFields.addView(saveConnection);saveConnection.setOnClickListener(v->saveConnection());
        Button editConnection=button("연결 정보 다시 입력",Color.rgb(71,85,105));connectionCard.addView(editConnection);editConnection.setOnClickListener(v->{connectionFields.setVisibility(View.VISIBLE);serverUrl.setText("");deviceKey.setText("");serverUrl.requestFocus();});

        LinearLayout permissionCard=card(root,"권한 설정");
        Button overlay=button("팝업 표시 권한 설정",Color.rgb(2,132,199));permissionCard.addView(overlay);overlay.setOnClickListener(v->requestOverlay());
        TextView overlayHelp=text("다른 앱을 사용하는 중에도 호출·전달 화면을 크게 표시합니다.",14,false);overlayHelp.setTextColor(Color.GRAY);permissionCard.addView(overlayHelp);
        Button battery=button("앱이 꺼지지 않도록 설정",Color.rgb(2,132,199));permissionCard.addView(battery);battery.setOnClickListener(v->requestBatteryExemption());
        TextView batteryHelp=text("배터리 최적화에서 제외해 백그라운드 수신이 중단되지 않게 합니다.",14,false);batteryHelp.setTextColor(Color.GRAY);permissionCard.addView(batteryHelp);

        LinearLayout operationCard=card(root,"운영");
        Button start=button("호출·전달 수신 시작",Color.rgb(29,78,216));operationCard.addView(start);start.setOnClickListener(v->startReceiver());
        Button stop=button("호출·전달 수신 중지",Color.rgb(185,28,28));operationCard.addView(stop);stop.setOnClickListener(v->stopReceiver());
        Button testCall=button("학생 호출 화면 테스트",Color.rgb(22,101,52));operationCard.addView(testCall);testCall.setOnClickListener(v->test(CallReceiverService.ACTION_TEST));
        Button testNotice=button("전달사항 화면·TTS 테스트",Color.rgb(22,101,52));operationCard.addView(testNotice);testNotice.setOnClickListener(v->test(CallReceiverService.ACTION_TEST_NOTICE));

        status=text("",18,true);status.setPadding(18,18,18,18);root.addView(status,new LinearLayout.LayoutParams(-1,-2));
        TextView foot=text("※ 정상 연결되면 상단 알림에 ‘연결됨 · 10초마다 확인’이 표시됩니다.",14,false);foot.setTextColor(Color.GRAY);root.addView(foot);
        return scroll;
    }

    private LinearLayout card(LinearLayout root,String title){LinearLayout c=new LinearLayout(this);c.setOrientation(LinearLayout.VERTICAL);c.setPadding(28,22,28,26);c.setBackground(round(Color.WHITE,22));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,0,0,16);root.addView(c,p);TextView t=text(title,21,true);t.setPadding(0,0,0,8);c.addView(t);return c;}
    private LinearLayout field(LinearLayout parent,String label,boolean half){LinearLayout w=new LinearLayout(this);w.setOrientation(LinearLayout.VERTICAL);w.setPadding(0,8,half?10:0,8);w.addView(text(label,15,true));parent.addView(w,half?new LinearLayout.LayoutParams(0,-2,1):new LinearLayout.LayoutParams(-1,-2));return w;}
    private EditText input(LinearLayout parent,String label,String hint){EditText e=new EditText(this);e.setTextSize(18);e.setHint(hint);e.setSingleLine(true);e.setPadding(16,12,16,12);e.setBackground(round(Color.rgb(245,247,250),12));field(parent,label,false).addView(e,new LinearLayout.LayoutParams(-1,58));return e;}
    private Spinner spinner(LinearLayout parent,String label,String[] items){Spinner s=new Spinner(this);setSpinnerItems(s,items);s.setBackground(round(Color.rgb(245,247,250),12));field(parent,label,true).addView(s,new LinearLayout.LayoutParams(-1,58));return s;}
    private void setSpinnerItems(Spinner s,String[] items){ArrayAdapter<String>a=new ArrayAdapter<>(this,android.R.layout.simple_spinner_item,items);a.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);s.setAdapter(a);}
    private CheckBox check(LinearLayout p,String label){CheckBox c=new CheckBox(this);c.setText(label);c.setTextSize(17);c.setPadding(8,9,8,9);p.addView(c);return c;}
    private TextView text(String s,int sp,boolean bold){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(Color.rgb(24,33,47));if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
    private Button button(String s,int color){Button b=new Button(this);b.setText(s);b.setTextSize(17);b.setTextColor(Color.WHITE);b.setAllCaps(false);b.setBackground(round(color,14));LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,64);p.setMargins(0,9,0,0);b.setLayoutParams(p);return b;}
    private GradientDrawable round(int color,int radius){GradientDrawable g=new GradientDrawable();g.setColor(color);g.setCornerRadius(radius);return g;}

    private void load(){loading=true;int g=Math.min(Prefs.MAX_GRADE,Prefs.number(prefs.getString(Prefs.GRADE,"1")));grade.setSelection(g-1);rebuildClasses(g,Prefs.number(prefs.getString(Prefs.CLASS_NO,"1")));autoStart.setChecked(prefs.getBoolean(Prefs.AUTO_START,true));sound.setChecked(prefs.getBoolean(Prefs.SOUND,true));voice.setChecked(prefs.getBoolean(Prefs.VOICE,true));voiceHideName.setChecked(prefs.getBoolean(Prefs.VOICE_HIDE_NAME,false));serverUrl.setText("");deviceKey.setText("");loading=false;updateConnectionState();}
    private void rebuildClasses(int g,int selected){int n=Prefs.classCountForGrade(g);String[] items=new String[n];for(int i=0;i<n;i++)items[i]=String.valueOf(i+1);setSpinnerItems(classNo,items);classNo.setSelection(Math.min(n,Math.max(1,selected))-1);}
    private String connectionSettings(){return prefs.getString(Prefs.SERVER_URL,"")+"|"+prefs.getString(Prefs.DEVICE_KEY,"")+"|"+Prefs.classId(this);}

    private void saveOptions(){String before=connectionSettings();int g=grade.getSelectedItemPosition()+1;int c=classNo.getSelectedItemPosition()+1;prefs.edit().putString(Prefs.GRADE,String.valueOf(g)).putString(Prefs.CLASS_NO,String.valueOf(c)).putBoolean(Prefs.AUTO_START,autoStart.isChecked()).putBoolean(Prefs.SOUND,sound.isChecked()).putBoolean(Prefs.VOICE,voice.isChecked()).putBoolean(Prefs.VOICE_HIDE_NAME,voiceHideName.isChecked()).apply();if(prefs.getBoolean(Prefs.ENABLED,false)&&!before.equals(connectionSettings()))restartService();updateStatus();}
    private void saveConnection(){String url=serverUrl.getText().toString().trim(),key=deviceKey.getText().toString().trim();if(url.isEmpty()||key.isEmpty()){toast("웹앱 주소와 수신기 키를 모두 입력해 주세요.");return;}if(!Prefs.isAppsScriptUrl(url)){toast("Apps Script 배포의 웹 앱 URL(…/exec)을 입력해 주세요.");return;}int q=url.indexOf('?');if(q>=0)url=url.substring(0,q);String before=connectionSettings();prefs.edit().putString(Prefs.SERVER_URL,url).putString(Prefs.DEVICE_KEY,key).apply();serverUrl.setText("");deviceKey.setText("");connectionFields.setVisibility(View.GONE);updateConnectionState();if(prefs.getBoolean(Prefs.ENABLED,false)&&!before.equals(connectionSettings()))restartService();toast("연결 정보를 저장했습니다. 저장된 값은 다시 표시하지 않습니다.");updateStatus();}
    private void updateConnectionState(){boolean set=!prefs.getString(Prefs.SERVER_URL,"").isEmpty()&&!prefs.getString(Prefs.DEVICE_KEY,"").isEmpty();connectionState.setText(set?"연결 정보: 설정 완료 ✓":"연결 정보: 입력 필요");connectionState.setTextColor(set?Color.rgb(22,101,52):Color.rgb(185,28,28));connectionFields.setVisibility(set?View.GONE:View.VISIBLE);}

    private void requestOverlay(){try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));}catch(Exception e){try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));}catch(Exception e2){toast("설정 → 앱 → 특별한 앱 액세스 → 다른 앱 위에 표시에서 허용해 주세요.");}}}
    private void requestBatteryExemption(){PowerManager pm=getSystemService(PowerManager.class);if(pm!=null&&pm.isIgnoringBatteryOptimizations(getPackageName())){toast("이미 앱이 꺼지지 않도록 설정되어 있습니다.");return;}try{startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,Uri.parse("package:"+getPackageName())));}catch(Exception e){try{startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));}catch(Exception e2){toast("이 기기에서는 해당 설정을 열 수 없습니다.");}}}
    private void startReceiver(){saveOptions();if(prefs.getString(Prefs.SERVER_URL,"").isEmpty()||prefs.getString(Prefs.DEVICE_KEY,"").isEmpty()){toast("먼저 웹앱 주소와 수신기 키를 저장해 주세요.");connectionFields.setVisibility(View.VISIBLE);return;}requestNotificationPermission();prefs.edit().putBoolean(Prefs.ENABLED,true).apply();startService();toast("호출·전달 수신을 시작했습니다.");updateStatus();}
    private void startService(){Intent i=new Intent(this,CallReceiverService.class);i.setAction(CallReceiverService.ACTION_START);startForegroundService(i);}
    private void restartService(){stopService(new Intent(this,CallReceiverService.class));startService();}
    private void stopReceiver(){prefs.edit().putBoolean(Prefs.ENABLED,false).apply();stopService(new Intent(this,CallReceiverService.class));toast("호출·전달 수신을 중지했습니다.");updateStatus();}
    private void requestNotificationPermission(){if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},100);}
    private void test(String action){saveOptions();if(!Settings.canDrawOverlays(this))requestNotificationPermission();Intent i=new Intent(this,CallReceiverService.class);i.setAction(action);startService(i);}
    private void updateStatus(){if(status==null)return;boolean overlay=Settings.canDrawOverlays(this),on=prefs.getBoolean(Prefs.ENABLED,false),notify=getSystemService(android.app.NotificationManager.class).areNotificationsEnabled();String mode=overlay?"가운데 팝업":(notify?"화면 위쪽 알림":"알림 권한 필요");String hours=prefs.getString(Prefs.ACTIVE_START,ActiveHours.DEFAULT_START)+"~"+prefs.getString(Prefs.ACTIVE_END,ActiveHours.DEFAULT_END);status.setText("등록 반: "+Prefs.classId(this)+"   ·   수신: "+(on?"켜짐":"꺼짐")+"   ·   운영 시간: "+hours+"\n표시 방식: "+mode+"   ·   TTS: "+(prefs.getBoolean(Prefs.VOICE,true)?prefs.getString(Prefs.TTS_STATUS,"확인 전"):"꺼짐")+"\n이 반 호출과 "+Prefs.classId(this).split("-")[0]+"학년 전체 전달사항을 수신합니다.");status.setBackground(round(on?Color.rgb(236,253,245):Color.rgb(255,247,237),14));updateConnectionState();}
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
    @Override protected void onResume(){super.onResume();updateStatus();}
}
