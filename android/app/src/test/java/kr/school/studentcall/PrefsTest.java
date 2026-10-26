package kr.school.studentcall;

import static org.junit.Assert.*;

import org.junit.Test;

public class PrefsTest {
    @Test public void acceptsAppsScriptDeployUrls(){
        assertTrue(Prefs.isAppsScriptUrl("https://script.google.com/macros/s/AKfycbx123/exec"));
        assertTrue(Prefs.isAppsScriptUrl("  https://script.google.com/macros/s/AKfycbx123/exec/  "));
        assertTrue(Prefs.isAppsScriptUrl("https://script.google.com/macros/s/AKfycbx123/exec?action=poll&key=x"));
        assertTrue(Prefs.isAppsScriptUrl("https://script.google.com/a/macros/school.kr/s/AKfycbx123/exec"));
    }

    @Test public void rejectsOldPcServerAndOtherUrls(){
        assertFalse(Prefs.isAppsScriptUrl("http://192.168.1.10:8080"));
        assertFalse(Prefs.isAppsScriptUrl("https://192.168.1.10:8080"));
        assertFalse(Prefs.isAppsScriptUrl("http://script.google.com/macros/s/AKfycbx123/exec"));
        assertFalse(Prefs.isAppsScriptUrl("https://script.google.com/macros/s/AKfycbx123/dev"));
        assertFalse(Prefs.isAppsScriptUrl("https://script.google.com.evil.example/macros/s/x/exec"));
        assertFalse(Prefs.isAppsScriptUrl(""));
        assertFalse(Prefs.isAppsScriptUrl(null));
    }
}
