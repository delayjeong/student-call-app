package kr.school.studentcall;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Settings;

/** 전자칠판을 켜거나 앱을 업데이트한 뒤 호출 수신을 자동으로 다시 시작한다. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        String a=intent.getAction();
        if(!Intent.ACTION_BOOT_COMPLETED.equals(a)&&!Intent.ACTION_MY_PACKAGE_REPLACED.equals(a))return;
        SharedPreferences p=Prefs.get(context);
        if(!p.getBoolean(Prefs.ENABLED,false)||!p.getBoolean(Prefs.AUTO_START,true))return;
        if(!Settings.canDrawOverlays(context))return;
        Intent i=new Intent(context,CallReceiverService.class);i.setAction(CallReceiverService.ACTION_START);
        try{context.startForegroundService(i);}catch(Exception ignored){}
    }
}
