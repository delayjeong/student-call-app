package kr.school.studentcall;

import static org.junit.Assert.*;

import org.junit.Test;

public class ActiveHoursTest {
    private static int m(String hhmm){return ActiveHours.minutes(hhmm);}

    @Test public void defaultWindowWithOneMinuteGrace(){
        assertFalse(ActiveHours.isActive(m("07:59"),"08:00","22:00"));
        assertTrue(ActiveHours.isActive(m("08:00"),"08:00","22:00"));
        assertTrue(ActiveHours.isActive(m("21:59"),"08:00","22:00"));
        assertTrue(ActiveHours.isActive(m("22:00"),"08:00","22:00")); // 끝나기 직전 호출을 받기 위한 1분 유예
        assertFalse(ActiveHours.isActive(m("22:01"),"08:00","22:00"));
    }

    @Test public void overnightWindow(){
        assertTrue(ActiveHours.isActive(m("23:00"),"22:00","06:00"));
        assertTrue(ActiveHours.isActive(m("05:00"),"22:00","06:00"));
        assertFalse(ActiveHours.isActive(m("12:00"),"22:00","06:00"));
    }

    @Test public void invalidValuesFallBackToDefault(){
        assertEquals(-1,m("25:00"));
        assertEquals(-1,m("abc"));
        assertTrue(ActiveHours.isActive(m("09:00"),"25:00","x"));
        assertFalse(ActiveHours.isActive(m("23:00"),"25:00","x"));
    }

    @Test public void minutesUntilStart(){
        assertEquals(0,ActiveHours.minutesUntilStart(m("10:00"),"08:00","22:00"));
        assertEquals(30,ActiveHours.minutesUntilStart(m("07:30"),"08:00","22:00"));
        assertEquals(10*60-2,ActiveHours.minutesUntilStart(m("22:02"),"08:00","22:00"));
    }

    @Test public void koreaTimeRegardlessOfDeviceZone(){
        // 2026-01-01 00:00 UTC = 09:00 KST
        assertEquals(9*60,ActiveHours.nowMinutes(1767225600000L));
    }
}
