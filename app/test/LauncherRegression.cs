using System;
using System.IO;
class LauncherRegression {
    static void Check(bool ok,string why) { if(!ok)throw new Exception(why); }
    static int Main() {
        string valid="http://127.0.0.1:4317/?launch="+new string('a',64);
        Check(Launcher.ValidSession(valid,4317),"valid session rejected");
        foreach(string value in new[]{valid+"\n",valid+"&other=1",valid.Replace("127.0.0.1","example.com"),valid.Replace("4317","4318"),valid.Replace("http:","https:"),valid.Replace(new string('a',64),new string('a',63))})
            Check(!Launcher.ValidSession(value,4317),"unsafe session accepted");
        Check(Launcher.EscapeArgument(@"D:\A folder\Videos")=="\"D:\\A folder\\Videos\"","path with spaces");
        Check(Launcher.EscapeArgument(@"D:\A folder\")=="\"D:\\A folder\\\\\"","trailing backslash");
        Check(Launcher.EscapeArgument("a\"b")=="\"a\\\"b\"","embedded quote");
        Check(Launcher.EscapeArgument("")=="\"\"","empty argument");
        int attempts=0;
        string result=Launcher.WaitForReady(()=>++attempts==1?null:valid,u=>attempts>=4,()=>false,3000);
        Check(result==valid && attempts==4,"cold startup opened before readiness");
        int probes=0;result=Launcher.WaitForReady(()=>valid,u=>{probes++;return false;},()=>true,1000);
        Check(result==null && probes==0,"exited engine must not open browser");
        result=Launcher.WaitForReady(()=>valid,u=>false,()=>false,200);
        Check(result==null,"stale session should time out");
        string browser=Launcher.BrowserArguments(valid,@"D:\User data\desktop-browser");
        Check(browser.Contains("--user-data-dir=\"D:\\User data\\desktop-browser\"") && browser.Contains("--no-first-run"),"dedicated profile missing");
        foreach(string flag in new[]{"--profile-directory=Default","--hide-crash-restore-bubble","--disable-sync","--disable-features=msImplicitSignin,Translate,msEdgeTranslate","--edge-skip-compat-layer-relaunch"})
            Check(browser.Contains(flag),"additional browser window prevention missing: "+flag);
        Check(!browser.Contains("--no-sandbox"),"browser sandbox was disabled");
        string fixture=Path.Combine(Path.GetDirectoryName(typeof(LauncherRegression).Assembly.Location),"app-data");
        string appProfile=Launcher.PrepareBrowserProfile(fixture);
        Check(File.Exists(Path.Combine(appProfile,"First Run")),"first-run marker missing");
        File.WriteAllText(Path.Combine(appProfile,"First Run"),"existing marker");
        Directory.CreateDirectory(Path.Combine(appProfile,"Default"));
        File.WriteAllText(Path.Combine(appProfile,"Default","Preferences"),"existing preferences");
        Check(Launcher.PrepareBrowserProfile(fixture)==appProfile,"profile directory changed");
        Check(File.ReadAllText(Path.Combine(appProfile,"First Run"))=="existing marker","marker overwritten");
        Check(File.ReadAllText(Path.Combine(appProfile,"Default","Preferences"))=="existing preferences","preferences overwritten");
        Launcher.CloseOwnedBrowser(null);
        Console.WriteLine("PASS: delayed cold startup, stale sessions, engine exit, argument quoting and profile isolation.");
        return 0;
    }
}
