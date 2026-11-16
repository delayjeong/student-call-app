package kr.school.studentcall;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.ArrayList;
import java.util.List;

public class MuteScheduleTest {
    private static int minute(String value) { return ActiveHours.minutes(value); }

    @Test public void multipleWindowsAndEdges() {
        String s="08:40-09:30;09:40-10:30;13:30-14:20";
        assertFalse(MuteSchedule.isMuted(s,minute("08:39")));
        assertTrue(MuteSchedule.isMuted(s,minute("08:40")));
        assertTrue(MuteSchedule.isMuted(s,minute("09:29")));
        assertFalse(MuteSchedule.isMuted(s,minute("09:30")));
        assertTrue(MuteSchedule.isMuted(s,minute("10:29")));
        assertFalse(MuteSchedule.isMuted(s,minute("12:30")));
        assertTrue(MuteSchedule.isMuted(s,minute("13:30")));
        assertFalse(MuteSchedule.isMuted(s,minute("14:20")));
    }

    @Test public void overnightAndOverlapping() {
        assertTrue(MuteSchedule.isMuted("22:30-06:10",minute("23:59")));
        assertTrue(MuteSchedule.isMuted("22:30-06:10",minute("00:00")));
        assertTrue(MuteSchedule.isMuted("22:30-06:10",minute("06:09")));
        assertFalse(MuteSchedule.isMuted("22:30-06:10",minute("06:10")));
        assertFalse(MuteSchedule.isMuted("22:30-06:10",minute("14:00")));
        assertTrue(MuteSchedule.isMuted("09:00-10:00;09:45-11:00",minute("10:20")));
    }

    @Test public void malformedRecordsDontMuteOrCrash() {
        assertFalse(MuteSchedule.isMuted(null,minute("10:00")));
        assertFalse(MuteSchedule.isMuted("",minute("10:00")));
        assertFalse(MuteSchedule.isMuted("bad;99:00-12:00;10:00-10:00",minute("10:00")));
        assertTrue(MuteSchedule.isMuted("bad;10:00-11:00",minute("10:00")));
        assertEquals(1,MuteSchedule.parse("bad;10:00-11:00").size());
        assertFalse(MuteSchedule.validTime("24:00"));
        assertFalse(MuteSchedule.validTime("8:00"));
        try { new MuteSchedule.Window("11:00","11:00"); fail("same endpoint"); }
        catch(IllegalArgumentException expected) {}
    }

    @Test public void addEditDeleteCanPersist() {
        List<MuteSchedule.Window> windows = new ArrayList<>();
        windows.add(new MuteSchedule.Window("08:40","09:30"));
        windows.add(new MuteSchedule.Window("10:40","11:30"));
        windows.set(0,new MuteSchedule.Window("09:00","09:50"));
        String saved=MuteSchedule.serialize(windows);
        assertEquals("09:00-09:50;10:40-11:30",saved);
        assertEquals(2,MuteSchedule.parse(saved).size());
        windows.remove(1);
        assertEquals("09:00-09:50",MuteSchedule.serialize(windows));
    }
}
