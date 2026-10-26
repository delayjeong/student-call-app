package kr.school.studentcall;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

/** 설정 저장소. 앱 화면, 수신 서비스, 부팅 수신기가 함께 사용한다. */
final class Prefs {
    static final String SERVER_URL="serverUrl", GRADE="grade", CLASS_NO="classNo", DEVICE_KEY="deviceKey", DEVICE_ID="deviceId";
    static final String ENABLED="enabled", AUTO_START="autoStart", SOUND="sound";
    /** 음성 안내 켜기 / 학생 이름 읽지 않기 / 음성 엔진 상태(서비스가 기록, 설정 화면에 표시) */
    static final String VOICE="voice", VOICE_HIDE_NAME="voiceHideName", TTS_STATUS="ttsStatus";
    /** 서버(Apps Script)가 확인 응답으로 알려 주는 운영 시간. 다음 날 시작 시각 계산에 쓴다. */
    static final String ACTIVE_START="activeStart", ACTIVE_END="activeEnd";
    /** 예전(PC 서버) 설정을 지웠음을 화면에 한 번 알리기 위한 표시 */
    static final String OLD_SERVER_CLEARED="oldServerCleared";
    private static volatile boolean migrated=false;
    static final int MAX_GRADE=6, MAX_CLASS=20;

    private Prefs(){}
    static SharedPreferences get(Context c){
        SharedPreferences p=c.getSharedPreferences("student_call",Context.MODE_PRIVATE);
        if(!migrated){migrated=true;migrate(p);}
        return p;
    }

    /**
     * 0.2 이하(PC 서버 방식)에서 덮어 설치하면 예전 서버 주소·수신기 키가 남는다.
     * Apps Script 주소가 아니면 지우고 수신을 꺼서, 새 웹앱 주소를 입력할 때까지 엉뚱한 곳에 접속하지 않게 한다.
     * 학년/반, 호출음, 자동 시작 설정은 그대로 둔다.
     */
    private static void migrate(SharedPreferences p){
        String url=p.getString(SERVER_URL,"");
        if(url.isEmpty()||isAppsScriptUrl(url))return;
        p.edit().remove(SERVER_URL).remove(DEVICE_KEY).putBoolean(ENABLED,false).putBoolean(OLD_SERVER_CLEARED,true).commit();
    }

    /** Apps Script 웹앱 배포 주소인지: https://script.google.com/…/exec */
    static boolean isAppsScriptUrl(String url){
        if(url==null)return false;
        String u=url.trim();
        int q=u.indexOf('?');if(q>=0)u=u.substring(0,q);
        while(u.endsWith("/"))u=u.substring(0,u.length()-1);
        return u.startsWith("https://script.google.com/")&&u.endsWith("/exec")&&u.contains("/macros/");
    }

    /** 서버와 같은 "학년-반" 형식. 예전 버전에서 "05"처럼 저장된 값도 숫자로 정규화한다. */
    static String classId(Context c){SharedPreferences p=get(c);return number(p.getString(GRADE,"1"))+"-"+number(p.getString(CLASS_NO,"1"));}
    static int number(String s){try{return Math.max(1,Integer.parseInt(s.trim()));}catch(Exception e){return 1;}}

    static String deviceId(Context c){SharedPreferences p=get(c);String id=p.getString(DEVICE_ID,"");if(id.isEmpty()){id=UUID.randomUUID().toString();p.edit().putString(DEVICE_ID,id).apply();}return id;}
}
