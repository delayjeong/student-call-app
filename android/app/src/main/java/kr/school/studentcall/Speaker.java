package kr.school.studentcall;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

/**
 * 호출 음성 안내 (기기에 설치된 TTS 엔진 사용).
 * 엔진이 없거나 한국어를 지원하지 않으면 조용히 아무것도 하지 않는다 — 알림음은 서비스가 따로 낸다.
 * 모든 메서드는 메인 스레드에서 부른다.
 */
final class Speaker {
    static final int REPEAT=2;
    private final Context ctx;
    private TextToSpeech tts;
    private volatile boolean ready=false, failed=false;
    /** 아직 다 읽지 않은 안내 (취소되면 빼고 다시 읽기 위해 보관) */
    private final List<String[]> pending=new ArrayList<>(); // {callId, text}

    Speaker(Context ctx){
        this.ctx=ctx.getApplicationContext();
        tts=new TextToSpeech(this.ctx,status->{
            if(status!=TextToSpeech.SUCCESS){fail("음성 엔진 없음");return;}
            int r=tts.setLanguage(Locale.KOREAN);
            if(r==TextToSpeech.LANG_MISSING_DATA||r==TextToSpeech.LANG_NOT_SUPPORTED){fail("한국어 음성 없음");return;}
            tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                @Override public void onStart(String id){}
                @Override public void onDone(String id){done(id);}
                @Override public void onError(String id){done(id);}
            });
            Prefs.get(this.ctx).edit().putString(Prefs.TTS_STATUS,"한국어 음성 사용 가능").apply();
            synchronized(Speaker.this){ready=true;for(String[] p:pending)enqueue(p[0],p[1]);}
        });
    }

    private synchronized void fail(String why){
        failed=true;pending.clear();
        Prefs.get(ctx).edit().putString(Prefs.TTS_STATUS,why).apply();
    }

    /** callId의 안내를 REPEAT번 읽는다 (알림음과 겹치지 않게 앞에 잠깐 쉼). */
    synchronized void say(String callId,String text){
        if(failed)return;
        String key=callId==null?"test":callId;
        pending.add(new String[]{key,text});
        if(ready)enqueue(key,text);
    }

    private void enqueue(String key,String text){
        tts.playSilentUtterance(700,TextToSpeech.QUEUE_ADD,key+"#pause");
        for(int i=1;i<=REPEAT;i++){
            tts.speak(text,TextToSpeech.QUEUE_ADD,new Bundle(),key+"#"+i);
            if(i<REPEAT)tts.playSilentUtterance(900,TextToSpeech.QUEUE_ADD,key+"#gap"+i);
        }
    }

    /** 마지막 반복을 다 읽으면 목록에서 뺀다 (UtteranceProgressListener는 다른 스레드에서 불린다). */
    private synchronized void done(String utteranceId){
        if(!utteranceId.endsWith("#"+REPEAT))return;
        String key=utteranceId.substring(0,utteranceId.lastIndexOf('#'));
        for(Iterator<String[]> it=pending.iterator();it.hasNext();)if(it.next()[0].equals(key)){it.remove();break;}
    }

    /** 취소된 호출은 읽기를 멈추고, 남은 다른 호출은 다시 읽는다. */
    synchronized void cancel(String callId){
        boolean had=false;
        for(Iterator<String[]> it=pending.iterator();it.hasNext();)if(it.next()[0].equals(callId)){it.remove();had=true;}
        if(!had||!ready)return;
        tts.stop();
        for(String[] p:pending)enqueue(p[0],p[1]);
    }

    synchronized void shutdown(){if(tts!=null){tts.stop();tts.shutdown();tts=null;}ready=false;pending.clear();}
}
