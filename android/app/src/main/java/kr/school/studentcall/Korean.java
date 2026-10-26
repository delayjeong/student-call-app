package kr.school.studentcall;

/** 호출 문구 (화면·음성 공통). Android에 의존하지 않아 단위 테스트로 검증한다. */
final class Korean {
    private Korean(){}

    /** "교무실로", "상담실로", "보건실로", "도서관으로" — 받침(ㄹ 제외)이 있으면 '으로' */
    static String directionParticle(String location){
        if(location==null||location.isEmpty())return "로";
        char c=location.charAt(location.length()-1);
        if(c>=0xAC00&&c<=0xD7A3){int jong=(c-0xAC00)%28;return (jong==0||jong==8)?"로":"으로";}
        return "로";
    }

    /** 음성 안내 문장. hideName이면 학생 이름·위치를 소리 내어 읽지 않는다. */
    static String spoken(String teacher,String student,String location,boolean hideName){
        if(hideName)return "학생 호출이 있습니다. 화면을 확인해 주세요.";
        return student+" 학생, "+location+directionParticle(location)+" 오세요. "+teacher+" 선생님 호출입니다.";
    }
}
