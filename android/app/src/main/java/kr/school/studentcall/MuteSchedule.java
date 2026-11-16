package kr.school.studentcall;

import java.util.ArrayList;
import java.util.List;

/** 전자칠판별 TTS 음소거 시간대. 서울 기준 분 단위, 시작 포함/끝 제외. */
final class MuteSchedule {
    static final class Window {
        final String start, end;
        Window(String start, String end) {
            if (!validTime(start) || !validTime(end) || start.equals(end))
                throw new IllegalArgumentException("시작과 종료 시각을 확인해 주세요.");
            this.start = start;
            this.end = end;
        }
        String encode() { return start + "-" + end; }
    }

    private MuteSchedule() {}

    static boolean validTime(String value) {
        if (value == null || !value.matches("\\d{2}:\\d{2}")) return false;
        int hour = Integer.parseInt(value.substring(0, 2));
        int minute = Integer.parseInt(value.substring(3, 5));
        return hour <= 23 && minute <= 59;
    }

    static List<Window> parse(String serialized) {
        List<Window> result = new ArrayList<>();
        if (serialized == null || serialized.isEmpty()) return result;
        for (String raw : serialized.split(";")) {
            String[] parts = raw.split("-", -1);
            if (parts.length != 2) continue;
            try { result.add(new Window(parts[0], parts[1])); }
            catch (IllegalArgumentException ignored) { /* 손상된 항목은 무시하고 수신 유지 */ }
        }
        return result;
    }

    static String serialize(List<Window> windows) {
        StringBuilder b = new StringBuilder();
        for (Window w : windows) {
            if (b.length() > 0) b.append(';');
            b.append(w.encode());
        }
        return b.toString();
    }

    static boolean isMuted(String serialized, int nowMinutes) {
        if (nowMinutes < 0 || nowMinutes >= 1440) return false;
        for (Window window : parse(serialized)) {
            int start = ActiveHours.minutes(window.start);
            int end = ActiveHours.minutes(window.end);
            if (start < end ? nowMinutes >= start && nowMinutes < end
                : nowMinutes >= start || nowMinutes < end) return true;
        }
        return false;
    }

    static boolean isMutedNow(String serialized) {
        return isMuted(serialized, ActiveHours.nowMinutes(System.currentTimeMillis()));
    }
}
