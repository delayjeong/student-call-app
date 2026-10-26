package kr.school.studentcall;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

/** 설정 저장소. 앱 화면, 수신 서비스, 부팅 수신기가 함께 사용한다. */
final class Prefs {
    static final String SERVER_URL="serverUrl", GRADE="grade", CLASS_NO="classNo", DEVICE_KEY="deviceKey", DEVICE_ID="deviceId";
    static final String ENABLED="enabled", AUTO_START="autoStart", SOUND="sound";
    /** 서버(Apps Script)가 확인 응답으로 알려 주는 운영 시간. 다음 날 시작 시각 계산에 쓴다. */
    static final String ACTIVE_START="activeStart", ACTIVE_END="activeEnd";
    static final int MAX_GRADE=6, MAX_CLASS=20;

    private Prefs(){}
    static SharedPreferences get(Context c){return c.getSharedPreferences("student_call",Context.MODE_PRIVATE);}

    /** 서버와 같은 "학년-반" 형식. 예전 버전에서 "05"처럼 저장된 값도 숫자로 정규화한다. */
    static String classId(Context c){SharedPreferences p=get(c);return number(p.getString(GRADE,"1"))+"-"+number(p.getString(CLASS_NO,"1"));}
    static int number(String s){try{return Math.max(1,Integer.parseInt(s.trim()));}catch(Exception e){return 1;}}

    static String deviceId(Context c){SharedPreferences p=get(c);String id=p.getString(DEVICE_ID,"");if(id.isEmpty()){id=UUID.randomUUID().toString();p.edit().putString(DEVICE_ID,id).apply();}return id;}
}
