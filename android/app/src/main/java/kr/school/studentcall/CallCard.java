package kr.school.studentcall;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Space;
import android.widget.TextView;

/** 호출 카드 화면. 다른 앱 위 팝업(CallReceiverService)과 전체 화면 호출(CallActivity)이 함께 쓴다. */
final class CallCard {
    static final int SHOW_SECONDS=15;
    final LinearLayout root;
    private final TextView countdown;

    CallCard(Context ctx,String teacher,String student,String location,Runnable onOk){
        root=new LinearLayout(ctx);root.setOrientation(LinearLayout.VERTICAL);root.setGravity(Gravity.CENTER);root.setPadding(60,44,60,36);
        GradientDrawable bg=new GradientDrawable();bg.setColor(Color.argb(248,255,255,255));bg.setCornerRadius(28);bg.setStroke(3,Color.rgb(29,78,216));root.setBackground(bg);
        root.addView(tv(ctx,"🔔  학생 호출",30,true,Color.rgb(29,78,216)));gap(ctx,18);
        root.addView(tv(ctx,teacher+" 선생님 호출",34,true,Color.rgb(30,41,59)));gap(ctx,14);
        root.addView(tv(ctx,student+" 학생",48,true,Color.rgb(15,23,42)));gap(ctx,12);
        root.addView(tv(ctx,location+Korean.directionParticle(location)+" 오세요",36,true,Color.rgb(185,28,28)));gap(ctx,16);
        Button ok=new Button(ctx);ok.setText("확인");ok.setTextSize(22);ok.setTextColor(Color.WHITE);ok.setAllCaps(false);
        GradientDrawable okBg=new GradientDrawable();okBg.setColor(Color.rgb(29,78,216));okBg.setCornerRadius(16);ok.setBackground(okBg);ok.setPadding(80,10,80,10);
        ok.setOnClickListener(v->onOk.run());root.addView(ok,new LinearLayout.LayoutParams(-2,-2));gap(ctx,10);
        countdown=tv(ctx,"",18,false,Color.GRAY);root.addView(countdown);
    }

    void setRemaining(int seconds){countdown.setText(seconds+"초 후 자동으로 닫힙니다.");}

    private static TextView tv(Context ctx,String s,int sp,boolean bold,int color){TextView t=new TextView(ctx);t.setText(s);t.setTextSize(sp);t.setTextColor(color);t.setGravity(Gravity.CENTER);if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
    private void gap(Context ctx,int dp){Space x=new Space(ctx);root.addView(x,new LinearLayout.LayoutParams(1,(int)(dp*ctx.getResources().getDisplayMetrics().density)));}
}
