package kr.school.studentcall;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.UUID;

/** 설정 저장소. */
final class Prefs {
    static final String SERVER_URL="serverUrl", GRADE="grade", CLASS_NO="classNo", DEVICE_KEY="deviceKey", DEVICE_ID="deviceId";
    static final String ENABLED="enabled", AUTO_START="autoStart", SOUND="sound";
    static final String VOICE="voice", VOICE_HIDE_NAME="voiceHideName", TTS_STATUS="ttsStatus";
    static final String ACTIVE_START="activeStart", ACTIVE_END="activeEnd";
    static final String OLD_SERVER_CLEARED="oldServerCleared";
    private static volatile boolean migrated=false;
    static final int MAX_GRADE=3, MAX_CLASS=5;
    private static final int[] CLASS_COUNTS={5,5,4};

    private Prefs(){}
    static SharedPreferences get(Context c){
        SharedPreferences p=c.getSharedPreferences("student_call",Context.MODE_PRIVATE);
        if(!migrated){migrated=true;migrate(p);}
        return p;
    }

    private static void migrate(SharedPreferences p){
        String url=p.getString(SERVER_URL,"");
        if(url.isEmpty()||isAppsScriptUrl(url))return;
        p.edit().remove(SERVER_URL).remove(DEVICE_KEY).putBoolean(ENABLED,false).putBoolean(OLD_SERVER_CLEARED,true).commit();
    }

    static boolean isAppsScriptUrl(String url){
        if(url==null)return false;
        String u=url.trim();
        int q=u.indexOf('?');if(q>=0)u=u.substring(0,q);
        while(u.endsWith("/"))u=u.substring(0,u.length()-1);
        return u.startsWith("https://script.google.com/")&&u.endsWith("/exec")&&u.contains("/macros/");
    }

    static int classCountForGrade(int grade){
        if(grade<1||grade>CLASS_COUNTS.length)return CLASS_COUNTS[0];
        return CLASS_COUNTS[grade-1];
    }

    static String classId(Context c){
        SharedPreferences p=get(c);
        int g=Math.min(MAX_GRADE,number(p.getString(GRADE,"1")));
        int cl=Math.min(classCountForGrade(g),number(p.getString(CLASS_NO,"1")));
        return g+"-"+cl;
    }
    static int number(String s){try{return Math.max(1,Integer.parseInt(s.trim()));}catch(Exception e){return 1;}}

    static String deviceId(Context c){SharedPreferences p=get(c);String id=p.getString(DEVICE_ID,"");if(id.isEmpty()){id=UUID.randomUUID().toString();p.edit().putString(DEVICE_ID,id).apply();}return id;}
}
