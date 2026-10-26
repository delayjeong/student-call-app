package kr.school.studentcall;

import java.util.Calendar;
import java.util.TimeZone;

/** 운영 시간(한국 시간) 계산. 서버(Apps Script)와 같은 기준으로 판단하도록 기기 시간대와 무관하게 Asia/Seoul을 쓴다. */
final class ActiveHours {
    static final String DEFAULT_START="08:00", DEFAULT_END="22:00";
    /** 끝나기 직전에 보낸 호출을 놓치지 않도록 끝난 뒤 1분 더 확인한다. */
    static final int GRACE_MINUTES=1;
    private static final TimeZone KST=TimeZone.getTimeZone("Asia/Seoul");

    private ActiveHours(){}

    static int minutes(String hhmm){
        try{String[] p=hhmm.trim().split(":");int h=Integer.parseInt(p[0]),m=Integer.parseInt(p[1]);if(h<0||h>23||m<0||m>59)return -1;return h*60+m;}catch(Exception e){return -1;}
    }

    static int nowMinutes(long epochMs){Calendar c=Calendar.getInstance(KST);c.setTimeInMillis(epochMs);return c.get(Calendar.HOUR_OF_DAY)*60+c.get(Calendar.MINUTE);}

    /** now가 [start, end+유예) 안인지. 잘못된 값이면 기본 시간을 쓴다. 자정을 넘는 구간(예: 22:00-06:00)도 처리한다. */
    static boolean isActive(int now,String start,String end){
        int s=minutes(start),e=minutes(end);
        if(s<0||e<0){s=minutes(DEFAULT_START);e=minutes(DEFAULT_END);}
        e=(e+GRACE_MINUTES)%(24*60);
        return s<=e?(now>=s&&now<e):(now>=s||now<e);
    }

    /** 다음 시작 시각까지 남은 분 (이미 운영 중이면 0). */
    static int minutesUntilStart(int now,String start,String end){
        if(isActive(now,start,end))return 0;
        int s=minutes(start);if(s<0)s=minutes(DEFAULT_START);
        return ((s-now)%(24*60)+24*60)%(24*60);
    }
}
