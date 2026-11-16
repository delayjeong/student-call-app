package kr.school.studentcall;

import static org.junit.Assert.*;
import org.junit.Test;

public class AudioPolicyTest {
    private static int at(String hhmm){ return ActiveHours.minutes(hhmm); }
    private static final String WINDOWS = "08:40-09:30;09:40-10:30;22:30-06:10";

    @Test public void bothSoundsStayOffDuringMutedWindows(){
        for(String time : new String[]{"08:40","09:29","09:40","10:29","23:00","05:59"}){
            assertFalse(AudioPolicy.shouldBeep(true,true,WINDOWS,at(time)));
            assertFalse(AudioPolicy.shouldSpeak(true,true,WINDOWS,at(time)));
        }
    }

    @Test public void soundsResumeAtBoundaries(){
        for(String time : new String[]{"08:39","09:30","10:30","06:10","15:00"}){
            assertTrue(AudioPolicy.shouldBeep(true,true,WINDOWS,at(time)));
            assertTrue(AudioPolicy.shouldSpeak(true,true,WINDOWS,at(time)));
        }
    }

    @Test public void existingIndividualSoundSwitchesStillApply(){
        assertFalse(AudioPolicy.shouldBeep(false,true,WINDOWS,at("12:00")));
        assertTrue(AudioPolicy.shouldSpeak(true,true,WINDOWS,at("12:00")));
        assertFalse(AudioPolicy.shouldSpeak(false,true,WINDOWS,at("12:00")));
        assertTrue(AudioPolicy.shouldBeep(true,true,WINDOWS,at("12:00")));
    }

    @Test public void noRemoteConfigMeansLegacyAudioSettings(){
        assertTrue(AudioPolicy.shouldBeep(true,false,WINDOWS,at("08:45")));
        assertTrue(AudioPolicy.shouldSpeak(true,false,WINDOWS,at("08:45")));
        assertFalse(AudioPolicy.isSilent(true,"",at("08:45")));
        assertFalse(AudioPolicy.isSilent(false,WINDOWS,at("08:45")));
    }
}
