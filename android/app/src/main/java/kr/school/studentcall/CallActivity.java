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

/** 오버레이 권한이 없을 때 호출/전달을 전체 화면으로 보여 주는 Activity. */
public class CallActivity extends Activity {
    static final String EXTRA_TYPE="type", EXTRA_TEACHER="teacher", EXTRA_STUDENT="student", EXTRA_LOCATION="location", EXTRA_MESSAGE="message", EXTRA_NOTIFY_ID="notifyId";
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Runnable tick=this::onTick;
    private CallCard card;private int remaining;

    @Override protected void onCreate(Bundle b){super.onCreate(b);if(Build.VERSION.SDK_INT>=27){setShowWhenLocked(true);setTurnScreenOn(true);}else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);show(getIntent());}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);show(intent);}
    private void show(Intent i){main.removeCallbacks(tick);card=new CallCard(this,i.getStringExtra(EXTRA_TYPE),i.getStringExtra(EXTRA_TEACHER),i.getStringExtra(EXTRA_STUDENT),i.getStringExtra(EXTRA_LOCATION),i.getStringExtra(EXTRA_MESSAGE),this::finish);FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.argb(170,15,23,42));FrameLayout.LayoutParams lp=new FrameLayout.LayoutParams((int)(getResources().getDisplayMetrics().widthPixels*0.72),-2,Gravity.CENTER);frame.addView(card.root,lp);setContentView(frame);int id=i.getIntExtra(EXTRA_NOTIFY_ID,0);if(id!=0)getSystemService(NotificationManager.class).cancel(id);remaining=CallCard.SHOW_SECONDS;card.setRemaining(remaining);main.postDelayed(tick,1000);}
    private void onTick(){remaining--;if(remaining<=0){finish();return;}card.setRemaining(remaining);main.postDelayed(tick,1000);}
    @Override protected void onDestroy(){main.removeCallbacks(tick);super.onDestroy();}
}
