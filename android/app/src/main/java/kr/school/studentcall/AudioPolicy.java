package kr.school.studentcall;

/** 중앙 시간표에 따른 알림음·TTS 공통 출력 정책. 팝업 출력과는 독립적이다. */
final class AudioPolicy {
    private AudioPolicy() {}

    static boolean isSilent(boolean synced, String muteWindows, int nowMinutes) {
        return synced && MuteSchedule.isMuted(muteWindows, nowMinutes);
    }

    static boolean shouldBeep(boolean soundEnabled, boolean synced, String muteWindows, int nowMinutes) {
        return soundEnabled && !isSilent(synced, muteWindows, nowMinutes);
    }

    static boolean shouldSpeak(boolean voiceEnabled, boolean synced, String muteWindows, int nowMinutes) {
        return voiceEnabled && !isSilent(synced, muteWindows, nowMinutes);
    }
}
