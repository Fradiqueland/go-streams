using System;
using System.IO;
using System.Collections.Generic;
using System.Security.Cryptography;

class InstalledDataRegression {
    static void Check(bool ok,string message) { if(!ok)throw new Exception(message); }
    static void Write(string root,string relative,string text) {
        string file=Path.Combine(root,relative);Directory.CreateDirectory(Path.GetDirectoryName(file));File.WriteAllText(file,text);
    }
    static Dictionary<string,string> Snapshot(string root) {
        var result=new Dictionary<string,string>();
        foreach(string file in Directory.GetFiles(root,"*",SearchOption.AllDirectories))
            using(var stream=File.OpenRead(file))using(var sha=SHA256.Create())result.Add(file.Substring(root.Length),BitConverter.ToString(sha.ComputeHash(stream)));
        return result;
    }
    static void Same(Dictionary<string,string> a,Dictionary<string,string> b,string message) {
        Check(a.Count==b.Count,message+" (file count)");
        foreach(var entry in a)Check(b.ContainsKey(entry.Key)&&b[entry.Key]==entry.Value,message+": "+entry.Key);
    }
    static int Main() {
        string root=Path.Combine(Path.GetDirectoryName(typeof(InstalledDataRegression).Assembly.Location),"installed-data");
        string source=Path.Combine(root,"portable","GoStreams-data"),local=Path.Combine(root,"local");
        Write(source,"project.json","{\"version\":1,\"media\":[],\"channels\":[],\"playlists\":[],\"schedules\":[],\"history\":[]}");
        Write(source,"vault.dpapi","protected Windows credentials");
        Write(source,Path.Combine("desktop-browser","Default","Network","Cookies"),"existing browser sessions");
        Write(source,Path.Combine("desktop-browser","Default","Local Storage","leveldb","000001.log"),"existing local preferences");
        Write(source,Path.Combine("desktop-browser","Default","Preferences"),"existing profile");
        Write(source,Path.Combine("downloads","video.mp4"),"managed media");
        Write(source,"session.url","http://127.0.0.1:4317/?launch="+new string('a',64));
        var original=Snapshot(source);
        Check(Launcher.FindPortableData(Path.GetDirectoryName(source))==source,"portable data was not discovered");
        string installed=Launcher.InstalledDataDirectory(local,source);
        Check(installed==Path.Combine(local,"Go Streams","data"),"installed data is version-dependent");
        Check(!File.Exists(Path.Combine(installed,"session.url")),"transient engine token was copied");
        foreach(var entry in original)if(entry.Key!=Path.DirectorySeparatorChar+"session.url") {
            string copy=installed+entry.Key;
            Check(File.Exists(copy),"missing migrated file: "+entry.Key);
            using(var stream=File.OpenRead(copy))using(var sha=SHA256.Create())Check(BitConverter.ToString(sha.ComputeHash(stream))==entry.Value,"changed migrated content");
        }
        Same(original,Snapshot(source),"migration modified the portable original");
        var beforeUpdate=Snapshot(installed);
        Write(source,"project.json","newer portable content must not overwrite installed data");
        for(int update=0;update<3;update++)Check(Launcher.InstalledDataDirectory(local,source)==installed,"upgrade selected a different data path");
        Same(beforeUpdate,Snapshot(installed),"upgrade/reinstallation changed profiles, cookies, credentials or project");
        string locked=Path.Combine(root,"locked-source"),other=Path.Combine(root,"failed-local");
        Write(locked,"project.json","preserved");Write(locked,"z-locked","locked browser database");
        using(var handle=new FileStream(Path.Combine(locked,"z-locked"),FileMode.Open,FileAccess.ReadWrite,FileShare.None)) {
            bool failed=false;try{Launcher.InstalledDataDirectory(other,locked);}catch(IOException){failed=true;}
            Check(failed,"locked browser profile was imported inconsistently");
        }
        Check(!Directory.Exists(Path.Combine(other,"Go Streams","data")),"failed migration published partial user data");
        Check(Directory.GetDirectories(Path.Combine(other,"Go Streams"),".data-migration-*").Length==0,"failed migration left staging data");
        Check(File.ReadAllText(Path.Combine(locked,"project.json"))=="preserved","failed migration changed original project");
        string nested=Path.Combine(source,"nested-local");bool rejected=false;
        try{Launcher.InstalledDataDirectory(nested,source);}catch(IOException){rejected=true;}
        Check(rejected,"migration into the old data tree was allowed");
        string marker=Path.Combine(root,"installed-app");Directory.CreateDirectory(marker);
        Check(!Launcher.Installed(marker),"portable folder marked installed");
        Write(marker,".installed","go-streams-installed-v1\n");Check(Launcher.Installed(marker),"installed marker ignored");
        string old=Environment.GetEnvironmentVariable("GO_STREAMS_DATA"),custom=Path.Combine(root,"custom");
        try{Environment.SetEnvironmentVariable("GO_STREAMS_DATA",custom);Check(Launcher.DataDirectory(marker)==custom,"explicit user data override lost");}
        finally{Environment.SetEnvironmentVariable("GO_STREAMS_DATA",old);}
        Console.WriteLine("PASS: portable migration, browser sessions, credentials, repeated upgrades, original preservation, locked-file rollback, nested-path rejection and explicit user data.");
        return 0;
    }
}
