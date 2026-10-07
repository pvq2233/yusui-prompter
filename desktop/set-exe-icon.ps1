param([Parameter(Mandatory=$true)][string]$ExePath,[string]$IconPath)
$ErrorActionPreference = 'Stop'
if (-not $IconPath) { $IconPath = Join-Path $PSScriptRoot 'icon.ico' }
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class YusuiIconResources {
    delegate bool EnumName(IntPtr module, IntPtr type, IntPtr name, IntPtr parameter);
    delegate bool EnumLanguage(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryExW(string file,IntPtr handle,uint flags);
    [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceNamesW(IntPtr module,IntPtr type,EnumName callback,IntPtr parameter);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceLanguagesW(IntPtr module,IntPtr type,IntPtr name,EnumLanguage callback,IntPtr parameter);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResourceW(string file,bool delete);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool UpdateResourceW(IntPtr update,IntPtr type,IntPtr name,ushort language,byte[] data,uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="UpdateResourceW")] static extern bool UpdateNamedResource(IntPtr update,IntPtr type,string name,ushort language,byte[] data,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResourceW(IntPtr update,bool discard);
    static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    public static void Apply(string exe,string ico) {
        var names = new List<string>(); var ids = new List<int>(); var languages=new HashSet<ushort>(); languages.Add(0);
        IntPtr module = LoadLibraryExW(exe,IntPtr.Zero,2);
        if(module==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        EnumLanguage collectLanguage=(m,t,n,l,p)=>{ languages.Add(l);return true; };
        EnumName callback = (m,t,n,p) => { if(((ulong)n.ToInt64()>>16)==0) ids.Add(n.ToInt32()); else names.Add(Marshal.PtrToStringUni(n)); EnumResourceLanguagesW(m,t,n,collectLanguage,IntPtr.Zero); return true; };
        try { EnumResourceNamesW(module,(IntPtr)14,callback,IntPtr.Zero); } finally { FreeLibrary(module); }
        if(ids.Count==0 && names.Count==0) ids.Add(1);
        byte[] icon = File.ReadAllBytes(ico); int count=BitConverter.ToUInt16(icon,4);
        using(var groupStream=new MemoryStream()) using(var group=new BinaryWriter(groupStream)) {
            group.Write((ushort)0);group.Write((ushort)1);group.Write((ushort)count);
            IntPtr update=BeginUpdateResourceW(exe,false);
            if(update==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            bool complete=false;
            try {
                for(int i=0;i<count;i++) {
                    int entry=6+i*16; int size=BitConverter.ToInt32(icon,entry+8); int offset=BitConverter.ToInt32(icon,entry+12);
                    byte[] image=new byte[size]; Buffer.BlockCopy(icon,offset,image,0,size);
                    foreach(ushort language in languages) Check(UpdateResourceW(update,(IntPtr)3,(IntPtr)(201+i),language,image,(uint)size));
                    group.Write(icon,entry,12);group.Write((ushort)(201+i));
                }
                byte[] data=groupStream.ToArray();
                foreach(ushort language in languages) {
                    foreach(int id in ids) Check(UpdateResourceW(update,(IntPtr)14,(IntPtr)id,language,data,(uint)data.Length));
                    foreach(string name in names) Check(UpdateNamedResource(update,(IntPtr)14,name,language,data,(uint)data.Length));
                }
                Check(EndUpdateResourceW(update,false)); complete=true;
            } finally { if(!complete) EndUpdateResourceW(update,true); }
        }
    }
}
'@
[YusuiIconResources]::Apply([System.IO.Path]::GetFullPath($ExePath),[System.IO.Path]::GetFullPath($IconPath))
Write-Output 'Green brand icon embedded in the client EXE.'
