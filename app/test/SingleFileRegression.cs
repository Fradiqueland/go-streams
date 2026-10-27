using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Text;
using System.Xml;
using System.Threading;
using System.Reflection;
class SingleFileRegression {
    static void Check(bool ok,string reason){if(!ok)throw new Exception(reason);}
    static void Reject(Action action,string reason){try{action();}catch{return;}throw new Exception(reason);}
    static void Quiet(string phase,long done,long total){}
    static byte[] Zip(params string[] values){
        using(var output=new MemoryStream()){
            using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){
                for(int i=0;i<values.Length;i+=2)
                    using(var stream=zip.CreateEntry(values[i]).Open()){
                        byte[] bytes=Encoding.UTF8.GetBytes(values[i+1]);stream.Write(bytes,0,bytes.Length);
                    }
            }
            return output.ToArray();
        }
    }
    static BundleSpec Spec(byte[] archive,params string[] values){
        var doc=new XmlDocument();var root=doc.CreateElement("bundle");doc.AppendChild(root);
        root.SetAttribute("schema","1");root.SetAttribute("version","0.15.5");
        using(var stream=new MemoryStream(archive))root.SetAttribute("sha256",SingleFileCache.Hash(stream));
        for(int i=0;i<values.Length;i+=2){
            var entry=doc.CreateElement("file");entry.SetAttribute("path",values[i]);
            byte[] bytes=Encoding.UTF8.GetBytes(values[i+1]);entry.SetAttribute("bytes",bytes.Length.ToString());
            using(var stream=new MemoryStream(bytes))entry.SetAttribute("sha256",SingleFileCache.Hash(stream));root.AppendChild(entry);
        }
        using(var input=new MemoryStream(Encoding.UTF8.GetBytes(doc.OuterXml)))return BundleSpec.Read(input);
    }
    static string Prepare(BundleSpec spec,byte[] zip,string root,out bool reused){
        return SingleFileCache.Ensure(spec,()=>new MemoryStream(zip,false),root,Quiet,out reused);
    }
    static int Main(){
        string root=Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),"cases");
        Directory.CreateDirectory(root);
        string[] files={"src/server.mjs","hello","runtime/win32-x64/node.exe","bundled-runtime","public/António.txt","Unicode content"};
        byte[] archive=Zip(files);var spec=Spec(archive,files);string cache=Path.Combine(root,"cache");bool reused;
        string ready=Prepare(spec,archive,cache,out reused);
        Check(!reused && File.ReadAllText(Path.Combine(ready,"src","server.mjs"))=="hello","cold extraction failed");
        string warm=SingleFileCache.Ensure(spec,()=>{throw new Exception("warm launch reopened the embedded archive");},cache,Quiet,out reused);
        Check(reused && warm==ready,"warm launch did not reuse the cache");
        File.WriteAllText(Path.Combine(ready,"src","server.mjs"),"HELLO");
        string repaired=Prepare(spec,archive,cache,out reused);
        Check(!reused && repaired==ready && File.ReadAllText(Path.Combine(ready,"src","server.mjs"))=="hello","same-size corruption was not repaired");
        Check(Directory.GetDirectories(cache,".replaced-*").Length==1,"old damaged cache was not preserved");
        foreach(string name in new[]{"../outside.txt","/outside.txt",@"C:\outside.txt","src/../outside","src//empty","src/CON.txt","src/file. ","src/x:stream"}){
            Reject(()=>Spec(Zip("src/a","a"),name,"a"),"unsafe extraction path accepted: "+name);
        }
        Reject(()=>Spec(Zip("src/a","a"),"src/A","a","src/a","a"),"case-colliding paths accepted");
        var corrupt=(byte[])archive.Clone();corrupt[corrupt.Length-1]^=1;
        string bad=Path.Combine(root,"bad-hash");
        Reject(()=>{bool r;Prepare(spec,corrupt,bad,out r);},"corrupted embedded package accepted");
        Check(!Directory.Exists(SingleFileCache.CachePath(bad,spec)),"corrupt package was committed");
        byte[] extra=Zip("src/a","a","src/extra","extra");var extraSpec=Spec(extra,"src/a","a");
        string extraRoot=Path.Combine(root,"extra");
        Reject(()=>{bool r;Prepare(extraSpec,extra,extraRoot,out r);},"unlisted payload file accepted");
        Check(Directory.GetDirectories(extraRoot,".stage-*").Length==0,"rejected extraction left executable staging files");
        byte[] duplicate=Zip("src/a","a","src/a","a");var duplicateSpec=Spec(duplicate,"src/a","a");
        Reject(()=>{bool r;Prepare(duplicateSpec,duplicate,Path.Combine(root,"duplicate"),out r);},"duplicate ZIP entry accepted");
        string cancelled=Path.Combine(root,"cancelled");
        Reject(()=>{bool r;SingleFileCache.Ensure(spec,()=>new MemoryStream(archive),cancelled,(phase,done,total)=>{if(phase=="Preparing Go Streams")throw new OperationCanceledException();},out r);},"cancelled extraction completed");
        Check(Directory.GetDirectories(cancelled,".stage-*").Length==0,"cancelled extraction was not cleaned up");
        Check(!Directory.Exists(SingleFileCache.CachePath(cancelled,spec)),"cancelled extraction was committed");
        string simultaneous=Path.Combine(root,"concurrent");Exception error=null;string a=null,b=null;
        var first=new Thread(()=>{try{bool r;a=Prepare(spec,archive,simultaneous,out r);}catch(Exception e){error=e;}});
        var second=new Thread(()=>{try{bool r;b=Prepare(spec,archive,simultaneous,out r);}catch(Exception e){error=e;}});
        first.Start();second.Start();first.Join();second.Join();
        Check(error==null && a==b && File.Exists(Path.Combine(a,".bundle-complete")),"concurrent first launch failed");
        string outer=Path.Combine(root,"outer"),local=Path.Combine(root,"local");
        Directory.CreateDirectory(outer);string old=Environment.GetEnvironmentVariable("GO_STREAMS_DATA");
        try {
            Environment.SetEnvironmentVariable("GO_STREAMS_DATA",null);
            Check(GoStreamsSingleFile.DataDirectory(outer,local)==Path.Combine(local,"Go Streams","data"),"default data location was inside extraction cache");
            string portable=Path.Combine(outer,"GoStreams","data");Directory.CreateDirectory(portable);
            File.WriteAllText(Path.Combine(portable,"project.json"),"preserved");
            Check(GoStreamsSingleFile.DataDirectory(outer,local)==portable,"existing portable data was not reused");
            string sidecar=Path.Combine(outer,"GoStreams-data");Directory.CreateDirectory(sidecar);
            Check(GoStreamsSingleFile.DataDirectory(outer,local)==sidecar,"portable sidecar was not selected");
            Environment.SetEnvironmentVariable("GO_STREAMS_DATA",Path.Combine(root,"custom"));
            Check(GoStreamsSingleFile.DataDirectory(outer,local)==Path.Combine(root,"custom"),"explicit data path ignored");
            Check(File.ReadAllText(Path.Combine(portable,"project.json"))=="preserved","existing project changed");
        } finally {Environment.SetEnvironmentVariable("GO_STREAMS_DATA",old);}
        Console.WriteLine("PASS: first extraction, warm reuse, same-size tamper repair, ZIP paths, duplicates, cancellation, concurrency and persistent data.");
        return 0;
    }
}
