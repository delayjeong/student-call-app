package kr.school.studentcall;

/** 화면·음성 안내 문구. */
final class Korean {
    private Korean(){}

    static String directionParticle(String location){
        if(location==null||location.isEmpty())return "로";
        char c=location.charAt(location.length()-1);
        if(c>=0xAC00&&c<=0xD7A3){int jong=(c-0xAC00)%28;return (jong==0||jong==8)?"로":"으로";}
        return "로";
    }

    static String spoken(String teacher,String student,String location,boolean hideName){
        if(hideName)return "학생 호출이 있습니다. 화면을 확인해 주세요.";
        return student+" 학생, "+location+directionParticle(location)+" 오세요. "+teacher+" 선생님 호출입니다.";
    }

    static String noticeSpoken(String teacher,String message){
        return teacher+" 선생님 전달사항입니다. "+message;
    }
}
