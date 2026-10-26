package kr.school.studentcall;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.FrameLayout;

/**
 * '다른 앱 위에 표시' 권한이 없을 때 쓰는 전체 화면 호출.
 * 호출 알림의 전체 화면 인텐트로 열린다 — 화면이 꺼져 있거나 잠겨 있으면 바로 뜨고,
 * 사용 중이면 Android가 화면 위쪽 알림으로 보여 주며 그 알림을 누르면 열린다.
 */
public class CallActivity extends Activity {
    static final String EXTRA_TEACHER="teacher", EXTRA_STUDENT="student", EXTRA_LOCATION="location", EXTRA_NOTIFY_ID="notifyId";
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Runnable tick=this::onTick;
    private CallCard card;
    private int remaining;

    @Override protected void onCreate(Bundle b){
        super.onCreate(b);
        if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        show(getIntent());
    }

    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);show(intent);}

    private void show(Intent i){
        main.removeCallbacks(tick);
        card=new CallCard(this,i.getStringExtra(EXTRA_TEACHER),i.getStringExtra(EXTRA_STUDENT),i.getStringExtra(EXTRA_LOCATION),this::finish);
        FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.argb(170,15,23,42));
        FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams((int)(getResources().getDisplayMetrics().widthPixels*0.72),-2,Gravity.CENTER);
        frame.addView(card.root,lp);
        setContentView(frame);
        // 알림을 지워 같은 호출이 위쪽에 남아 있지 않게
        int id=i.getIntExtra(EXTRA_NOTIFY_ID,0);
        if(id!=0)getSystemService(NotificationManager.class).cancel(id);
        remaining=CallCard.SHOW_SECONDS;card.setRemaining(remaining);
        main.postDelayed(tick,1000);
    }

    private void onTick(){remaining--;if(remaining<=0){finish();return;}card.setRemaining(remaining);main.postDelayed(tick,1000);}

    @Override protected void onDestroy(){main.removeCallbacks(tick);super.onDestroy();}
}
