package kr.school.studentcall;

import static org.junit.Assert.*;

import org.junit.Test;

public class KoreanTest {
    @Test public void directionParticle(){
        assertEquals("로",Korean.directionParticle("교무실")); // ㄹ 받침
        assertEquals("로",Korean.directionParticle("보건실"));
        assertEquals("로",Korean.directionParticle("행정실"));
        assertEquals("로",Korean.directionParticle("과학실"));
        assertEquals("으로",Korean.directionParticle("도서관"));
        assertEquals("으로",Korean.directionParticle("운동장"));
        assertEquals("로",Korean.directionParticle("교감실 앞 복도"));
        assertEquals("로",Korean.directionParticle("2층"+"교무"));
        assertEquals("로",Korean.directionParticle("Lab"));
        assertEquals("로",Korean.directionParticle(""));
    }

    @Test public void spokenSentence(){
        assertEquals("김민수 학생, 교무실로 오세요. 김수학 선생님 호출입니다.",Korean.spoken("김수학","김민수","교무실",false));
        assertEquals("박서연 학생, 도서관으로 오세요. 이영어 선생님 호출입니다.",Korean.spoken("이영어","박서연","도서관",false));
        assertEquals("학생 호출이 있습니다. 화면을 확인해 주세요.",Korean.spoken("김수학","김민수","교무실",true));
    }
}
