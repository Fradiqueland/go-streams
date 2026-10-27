package main
import("fmt";"os"; dmg "github.com/jetbrains/go-dmg-writer")
func main(){
 if len(os.Args)!=4{panic("usage: gostreams-dmg INPUT.zip OUTPUT.dmg SCRATCH")}
 if _,err:=os.Stat(os.Args[2]);!os.IsNotExist(err){panic("Output already exists; preserve it")}
 d:=&dmg.DMG{VolumeName:"Go Streams",OwnerID:dmg.OwnerIDUnset,GroupID:dmg.OwnerIDUnset,PartitionMap:true,TempDir:os.Args[3]}
 fmt.Println("Building compressed Mac disk image...")
 if err:=d.CreateFromZIP(os.Args[1],os.Args[2],dmg.ModeReadOnlyCompressed);err!=nil{panic(err)}
 fmt.Println("DMG_CREATED")
}
