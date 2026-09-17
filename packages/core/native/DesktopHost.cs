// CampusOS desktop host. Independently implemented against the Win32 APIs.
// This process never receives keyboard input or calendar/account data.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

class DesktopHost {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Mouse { public Point Pt; public uint Data,Flags,Time; public UIntPtr Extra; }
    sealed class Snapshot { public Rect[] Rects; public long Time; public int Epoch; }
    delegate bool EnumProc(IntPtr h,IntPtr arg);
    delegate IntPtr HookProc(int code,IntPtr msg,IntPtr data);
    delegate void EventProc(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls,string title);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr arg);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint msg,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child,IntPtr parent);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetStyle(IntPtr h,int index);
    [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetStyle(IntPtr h,int index,IntPtr value);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect rect);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect rect);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h,ref Point p);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref Point p);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id,HookProc callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr msg,IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,EventProc callback,uint pid,uint tid,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint milliseconds);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr process,IntPtr address,UIntPtr size,uint allocation,uint protect);
    [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr process,IntPtr address,UIntPtr size,uint type);
    [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr process,IntPtr address,byte[] data,UIntPtr size,out UIntPtr written);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr process,IntPtr address,byte[] data,UIntPtr size,out UIntPtr read);

    static IntPtr target,originalParent,originalStyle,parent,progman,defview,worker,icons,hook,eventHook,targetProcess;
    static uint targetPid,targetThread,explorerPid,iconThread;
    static volatile bool stopping;
    static volatile Snapshot snapshot;
    static int iconEpoch;
    static int inputReady;
    static bool captured,foreignDrag,raised;
    static uint lastClickTime;
    static Point lastClickPoint,gesturePoint,lastOwnedPoint,lastDownPoint;
    static Rect originalRect,gestureRect,lastDownRect,placedRect;
    static string gesture;
    static HookProc mouseCallback=OnMouse;
    static EventProc eventCallback=OnIconEvent;
    static ConcurrentQueue<string> output=new ConcurrentQueue<string>();
    static ConcurrentQueue<string> commands=new ConcurrentQueue<string>();
    static AutoResetEvent outputReady=new AutoResetEvent(false);
    static bool Contains(Rect r,Point p) { return p.X>=r.Left&&p.X<r.Right&&p.Y>=r.Top&&p.Y<r.Bottom; }
    static IntPtr Packed(Point p) { return new IntPtr(unchecked((p.Y<<16)|(p.X&65535))); }
    static void Log(string value) { if(output.Count<256){output.Enqueue(value);outputReady.Set();} }
    static bool TargetAlive() {
        if(targetProcess==IntPtr.Zero||WaitForSingleObject(targetProcess,0)!=258||!IsWindow(target))return false;
        uint pid;return GetWindowThreadProcessId(target,out pid)==targetThread&&pid==targetPid;
    }
    static void Place(Rect r) {
        if(r.Left==placedRect.Left&&r.Top==placedRect.Top&&r.Right==placedRect.Right&&r.Bottom==placedRect.Bottom)return;
        var p=new Point{X=r.Left,Y=r.Top};ScreenToClient(parent,ref p);
        if(!SetWindowPos(target,raised?defview:IntPtr.Zero,p.X,p.Y,r.Right-r.Left,r.Bottom-r.Top,0x10|0x20|0x40|0x4000))throw new Exception("placement-failed");
        placedRect=r;
        Log("bounds="+r.Left+","+r.Top+","+(r.Right-r.Left)+","+(r.Bottom-r.Top));
    }
    static void Attach() {
        progman=FindWindow("Progman",null);
        if(progman==IntPtr.Zero)throw new Exception("desktop-unavailable");
        IntPtr result;
        SendMessageTimeout(progman,0x052c,new IntPtr(0xd),new IntPtr(1),2,1000,out result);
        EnumWindows(delegate(IntPtr h,IntPtr p) {
            var view=FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null);
            if(view!=IntPtr.Zero){defview=view;worker=FindWindowEx(IntPtr.Zero,h,"WorkerW",null);}
            return true;
        },IntPtr.Zero);
        raised=(GetStyle(progman,-20).ToInt64()&0x00200000)!=0;
        if(raised){defview=FindWindowEx(progman,IntPtr.Zero,"SHELLDLL_DefView",null);worker=FindWindowEx(progman,IntPtr.Zero,"WorkerW",null);}
        if(worker==IntPtr.Zero||defview==IntPtr.Zero)throw new Exception("desktop-layer-not-found");
        icons=FindWindowEx(defview,IntPtr.Zero,"SysListView32",null);
        if(icons==IntPtr.Zero)throw new Exception("icons-unavailable");
        iconThread=GetWindowThreadProcessId(icons,out explorerPid);
        parent=raised?progman:worker;
        SetStyle(target,-16,new IntPtr((originalStyle.ToInt64()&~0x80000000L)|0x40000000L));
        SetParent(target,parent);
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        if(GetParent(target)!=parent)throw new Exception("attach-failed");
        Place(originalRect);
    }
    static void OnIconEvent(IntPtr h,uint evt,IntPtr hwnd,int obj,int child,uint tid,uint time) {
        if((hwnd==icons||hwnd==defview)&&(evt<=0x8004||evt==0x800b)){Interlocked.Increment(ref iconEpoch);snapshot=null;}
    }
    // All Explorer queries run off the low-level hook thread. Immutable snapshots
    // include labels and icon spacing; unknown/stale state always leaves input to Explorer.
    static void ReadIcons() {
        for(int attempt=0;attempt<3&&!stopping;attempt++) {
            try{ReadIconsAttempt();}catch{snapshot=null;}
            if(!stopping)Thread.Sleep(250*(attempt+1));
        }
        if(!stopping)Log("failure=icon-snapshot-unavailable");
    }
    static void ReadIconsAttempt() {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        IntPtr process=OpenProcess(0x100000|0x0008|0x0010|0x0020,false,explorerPid);
        IntPtr memory=process==IntPtr.Zero?IntPtr.Zero:VirtualAllocEx(process,IntPtr.Zero,new UIntPtr(16),0x1000|0x2000,4);
        bool timedOut=false;
        try {
            while(!stopping&&memory!=IntPtr.Zero&&IsWindow(icons)) {
                snapshot=null;
                uint currentPid;
                if(WaitForSingleObject(process,0)!=258||GetWindowThreadProcessId(icons,out currentPid)!=iconThread||currentPid!=explorerPid)break;
                int epoch=iconEpoch;IntPtr count;
                if(SendMessageTimeout(icons,0x1004,IntPtr.Zero,IntPtr.Zero,2,200,out count)==IntPtr.Zero)break;
                int length=count.ToInt32();if(length<0||length>4096)break;
                var rects=new List<Rect>();bool valid=true;
                if(IsWindowVisible(icons))for(int index=0;index<length&&!stopping;index++) {
                    var bytes=new byte[16];UIntPtr transferred;IntPtr result;
                    // LVIR_BOUNDS = 0 includes the entire selectable label area.
                    if(!WriteProcessMemory(process,memory,bytes,new UIntPtr(16),out transferred)){valid=false;break;}
                    if(SendMessageTimeout(icons,0x100e,new IntPtr(index),memory,2,200,out result)==IntPtr.Zero){timedOut=true;valid=false;break;}
                    if(result==IntPtr.Zero||!ReadProcessMemory(process,memory,bytes,new UIntPtr(16),out transferred)||transferred.ToUInt64()!=16){valid=false;break;}
                    Point a=new Point{X=BitConverter.ToInt32(bytes,0),Y=BitConverter.ToInt32(bytes,4)};
                    Point b=new Point{X=BitConverter.ToInt32(bytes,8),Y=BitConverter.ToInt32(bytes,12)};
                    if(!ClientToScreen(icons,ref a)||!ClientToScreen(icons,ref b)){valid=false;break;}
                    rects.Add(new Rect{Left=a.X,Top=a.Y,Right=b.X,Bottom=b.Y});
                }
                if(!valid)break;
                if(stopping)break;
                if(epoch==iconEpoch){
                    snapshot=new Snapshot{Rects=rects.ToArray(),Epoch=epoch,Time=Stopwatch.GetTimestamp()};
                    if(Interlocked.Exchange(ref inputReady,1)==0)Log("ready");
                }
                Thread.Sleep(50);
            }
        } finally {
            snapshot=null;
            // A timed-out cross-process SendMessage may still dereference this
            // buffer later. Leave its 16 bytes owned by Explorer until it exits.
            if(memory!=IntPtr.Zero&&!timedOut)VirtualFreeEx(process,memory,UIntPtr.Zero,0x8000);
            if(process!=IntPtr.Zero)CloseHandle(process);
        }
    }
    static bool EmptyDesktop(Point p) {
        var hit=WindowFromPoint(p);
        if(hit!=icons&&hit!=defview&&hit!=progman&&hit!=worker&&hit!=target)return false;
        var current=snapshot;
        if(current==null||current.Epoch!=iconEpoch||(Stopwatch.GetTimestamp()-current.Time)*1000/Stopwatch.Frequency>250)return false;
        foreach(var rect in current.Rects)if(Contains(rect,p))return false;
        return true;
    }
    static IntPtr OnMouse(int code,IntPtr message,IntPtr data) {
        if(code<0||stopping)return CallNextHookEx(hook,code,message,data);
        var dpi=SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            uint msg=(uint)message.ToInt64();
            if(msg!=0x200&&msg!=0x201&&msg!=0x202&&msg!=0x20a)return CallNextHookEx(hook,code,message,data);
            var m=(Mouse)Marshal.PtrToStructure(data,typeof(Mouse));
            Rect rect;
            bool route=captured;
            if(!route&&msg!=0x202&&!foreignDrag&&GetWindowRect(target,out rect)&&Contains(rect,m.Pt)&&EmptyDesktop(m.Pt))route=true;
            if(msg==0x201&&!route){foreignDrag=true;lastClickTime=0;}
            if(msg==0x202)foreignDrag=false;
            if(!route)return CallNextHookEx(hook,code,message,data);
            if(msg==0x201){captured=true;lastDownPoint=m.Pt;GetWindowRect(target,out lastDownRect);}
            if(captured)lastOwnedPoint=m.Pt;
            Point point=m.Pt;if(!ScreenToClient(target,ref point))return CallNextHookEx(hook,code,message,data);
            if(msg==0x20a) {
                Rect client;if(!GetClientRect(target,out client))return CallNextHookEx(hook,code,message,data);
                Log("wheel="+point.X+","+point.Y+","+unchecked((short)(m.Data>>16))+","+client.Right+","+client.Bottom);
                return new IntPtr(1);
            }
            uint send=msg;
            if(msg==0x201) {
                if(lastClickTime!=0&&m.Time-lastClickTime<=GetDoubleClickTime()&&Math.Abs(m.Pt.X-lastClickPoint.X)<=GetSystemMetrics(36)/2&&Math.Abs(m.Pt.Y-lastClickPoint.Y)<=GetSystemMetrics(37)/2){send=0x203;lastClickTime=0;}
                else{lastClickTime=m.Time;lastClickPoint=m.Pt;}
            }
            int keys=(captured&&msg!=0x202?1:0)|((GetAsyncKeyState(0x10)&0x8000)!=0?4:0)|((GetAsyncKeyState(0x11)&0x8000)!=0?8:0);
            if(!PostMessage(target,send,new IntPtr(keys),Packed(point))){captured=false;return CallNextHookEx(hook,code,message,data);}
            if(msg==0x202)captured=false;
            return msg==0x200&&!captured?CallNextHookEx(hook,code,message,data):new IntPtr(1);
        }catch{captured=false;return CallNextHookEx(hook,code,message,data);}
        finally{SetThreadDpiAwarenessContext(dpi);}
    }
    static void Command(string command) {
        if((command=="drag-start"||command=="resize-start")&&captured) {gesturePoint=lastDownPoint;gestureRect=lastDownRect;gesture=command;}
        else if(command=="drag-end"||command=="resize-end"){MoveGesture();gesture=null;}
    }
    static void MoveGesture() {
        if(gesture!=null) {
            // Use the owned hook event, never a delayed GetCursorPos after the
            // user has released/restored the pointer or moved to another app.
            int dx=lastOwnedPoint.X-gesturePoint.X,dy=lastOwnedPoint.Y-gesturePoint.Y;Rect r=gestureRect;
            if(gesture=="drag-start"){r.Left+=dx;r.Right+=dx;r.Top+=dy;r.Bottom+=dy;}
            else{r.Right=r.Left+Math.Max(600,r.Right-r.Left+dx);r.Bottom=r.Top+Math.Max(450,r.Bottom-r.Top+dy);}
            Place(r);
        }
    }
    [STAThread] static void Main(string[] args) {
        var writer=new Thread(delegate(){while(!stopping||!output.IsEmpty){string line;while(output.TryDequeue(out line)){try{Console.WriteLine(line);Console.Out.Flush();}catch{stopping=true;}}outputReady.WaitOne(100);}});writer.IsBackground=true;writer.Start();
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            target=new IntPtr(long.Parse(args[0]));
            originalRect=new Rect{Left=int.Parse(args[1]),Top=int.Parse(args[2]),Right=int.Parse(args[1])+int.Parse(args[3]),Bottom=int.Parse(args[2])+int.Parse(args[4])};
            targetThread=GetWindowThreadProcessId(target,out targetPid);targetProcess=OpenProcess(0x100000|0x1000,false,targetPid);
            originalParent=GetParent(target);originalStyle=GetStyle(target,-16);
            if(!TargetAlive())throw new Exception("target-unavailable");
            Attach();
            eventHook=SetWinEventHook(0x8000,0x800b,IntPtr.Zero,eventCallback,explorerPid,0,0);
            if(eventHook==IntPtr.Zero)throw new Exception("icon-events-unavailable");
            hook=SetWindowsHookEx(14,mouseCallback,GetModuleHandle(null),0);
            if(hook==IntPtr.Zero)throw new Exception("mouse-hook-unavailable");
            Log("double-click="+GetDoubleClickTime());
            var reader=new Thread(ReadIcons);reader.IsBackground=true;reader.Start();
            var input=new Thread(delegate(){try{string line;while((line=Console.ReadLine())!=null){if(commands.Count<128)commands.Enqueue(line);}}finally{stopping=true;}});input.IsBackground=true;input.Start();
            var timer=new System.Windows.Forms.Timer();timer.Interval=16;
            timer.Tick+=delegate {
                var dpi=SetThreadDpiAwarenessContext(new IntPtr(-4));
                try {
                if(stopping||!TargetAlive()||!IsWindow(parent)||!IsWindow(icons)){Application.ExitThread();return;}
                if(!IsWindowVisible(target))SetWindowPos(target,IntPtr.Zero,0,0,0,0,0x1|0x2|0x4|0x10|0x40|0x4000);
                string command;while(commands.TryDequeue(out command))Command(command);
                MoveGesture();
                if(!captured)gesture=null;
                } finally {SetThreadDpiAwarenessContext(dpi);}
            };
            timer.Start();Application.Run();timer.Stop();
            stopping=true;reader.Join(500);
        }catch(Exception ex){Log("failure="+ex.Message);}
        finally{
            if(hook!=IntPtr.Zero)UnhookWindowsHookEx(hook);
            if(eventHook!=IntPtr.Zero)UnhookWinEvent(eventHook);
            if(TargetAlive()){SetParent(target,originalParent);SetStyle(target,-16,originalStyle);}
            if(targetProcess!=IntPtr.Zero)CloseHandle(targetProcess);
            stopping=true;outputReady.Set();writer.Join(500);
        }
    }
}
