package main
import("os";"path/filepath";"testing")
func fixture(t *testing.T, arch string) string {
 t.Helper();base:=filepath.Join(t.TempDir(),"Folder with spaces", "GoStreams.app", "Contents")
 for _,file:=range []string{"MacOS/GoStreams","Resources/app/runtime/darwin-"+arch+"/node","Resources/app/src/server.mjs"}{p:=filepath.Join(base,filepath.FromSlash(file));if err:=os.MkdirAll(filepath.Dir(p),0755);err!=nil{t.Fatal(err)};if err:=os.WriteFile(p,[]byte("fixture"),0755);err!=nil{t.Fatal(err)}}
 return filepath.Join(base,"MacOS","GoStreams")
}
func TestBundledRuntimeFromRelocatedBundle(t *testing.T){
 for _,item:=range []struct{cpu,folder string}{{"amd64","x64"},{"arm64","arm64"}}{t.Run(item.cpu,func(t *testing.T){exe:=fixture(t,item.folder);p,err:=plan(exe,item.cpu);if err!=nil{t.Fatal(err)};cmd:=command(p);if cmd.Path!=p.node||len(cmd.Args)!=3||cmd.Args[1]!=p.server||cmd.Args[2]!="--open"||cmd.Dir!=p.directory{t.Fatalf("unexpected command: %#v",cmd)};if filepath.Base(filepath.Dir(p.node))!="darwin-"+item.folder{t.Fatal("wrong runtime")}})}
}
func TestNoFallbackToDevelopmentRuntime(t *testing.T){
 exe:=fixture(t,"x64");p,err:=plan(exe,"amd64");if err!=nil{t.Fatal(err)};if err=os.Remove(p.node);err!=nil{t.Fatal(err)};if _,err=plan(exe,"amd64");err==nil{t.Fatal("missing bundled Node accepted")};if _,err=plan(exe,"386");err==nil{t.Fatal("unsupported CPU accepted")}
}
func TestMissingApplicationFilesFail(t *testing.T){
 exe:=fixture(t,"arm64");p,err:=plan(exe,"arm64");if err!=nil{t.Fatal(err)};if err=os.Remove(p.server);err!=nil{t.Fatal(err)};if _,err=plan(exe,"arm64");err==nil{t.Fatal("missing application accepted")}
}
