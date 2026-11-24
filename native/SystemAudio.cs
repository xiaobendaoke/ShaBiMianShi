using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace InterviewDogNative
{
    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject { }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        int RegisterEndpointNotificationCallback(IntPtr pClient);
        int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out int pdwState);
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClient
    {
        int Initialize(int ShareMode, uint StreamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr AudioSessionGuid);
        int GetBufferSize(out uint pNumBufferFrames);
        int GetStreamLatency(out long phnsLatency);
        int GetCurrentPadding(out uint pNumPaddingFrames);
        int IsFormatSupported(int ShareMode, IntPtr pFormat, out IntPtr ppClosestMatch);
        int GetMixFormat(out IntPtr ppDeviceFormat);
        int GetDevicePeriod(out long phnsDefaultDevicePeriod, out long phnsMinimumDevicePeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr eventHandle);
        int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport]
    [Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr ppData, out uint pNumFramesToRead, out uint pdwFlags, out ulong pu64DevicePosition, out ulong pu64QPCPosition);
        int ReleaseBuffer(uint NumFramesRead);
        int GetNextPacketSize(out uint pNumFramesInNextPacket);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    internal struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    internal sealed class LoopbackSession : IDisposable
    {
        public IMMDevice Device;
        public IAudioClient Client;
        public IAudioCaptureClient Capture;
        public string DeviceId;
        public int Channels;
        public int SampleRate;
        public int BitsPerSample;
        public bool IsFloat;
        public bool Direct48kMonoFloat;

        public void Dispose()
        {
            if (Client != null)
            {
                try { Client.Stop(); } catch { }
                Marshal.ReleaseComObject(Client);
                Client = null;
            }
            if (Capture != null)
            {
                Marshal.ReleaseComObject(Capture);
                Capture = null;
            }
            if (Device != null)
            {
                Marshal.ReleaseComObject(Device);
                Device = null;
            }
        }
    }

    internal static class Program
    {
        private const int ERender = 0;
        private const int EConsole = 0;
        private const int ClsCtxAll = 23;
        private const uint StreamFlagsLoopback = 0x00020000u;
        private const uint StreamFlagsAutoConvertPcm = 0x80000000u;
        private const uint StreamFlagsSrcDefaultQuality = 0x08000000u;
        private const uint BufferFlagSilent = 0x00000002u;
        private const int TargetSampleRate = 48000;
        private const int SilenceFrames40Ms = 1920; // 40ms @ 48kHz

        private static readonly Guid IidAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        private static readonly Guid IidAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
        private static readonly Guid SubTypeIeeeFloat = new Guid("00000003-0000-0010-8000-00aa00389b71");
        private static readonly Guid SubTypePcm = new Guid("00000001-0000-0010-8000-00aa00389b71");

        [STAThread]
        private static int Main(string[] args)
        {
            int parentPid = ParseParentPid(args);
            Process parentProcess = null;
            if (parentPid > 0)
            {
                try { parentProcess = Process.GetProcessById(parentPid); }
                catch { return 0; }
            }

            IMMDeviceEnumerator enumerator = null;
            LoopbackSession session = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                int initHr;
                session = OpenLoopbackSession(enumerator, out initHr);
                if (session == null)
                {
                    if (initHr == unchecked((int)0x80070490))
                    {
                        WriteError("ERROR:no_device code=" + initHr);
                        return 1;
                    }
                    WriteError("ERROR:capture code=" + initHr);
                    return 1;
                }

                Stream stdout = Console.OpenStandardOutput();
                Console.Error.Write("READY\n");
                Console.Error.Flush();

                byte[] silenceBytes = new byte[SilenceFrames40Ms * 4];
                byte[] outBuffer = new byte[TargetSampleRate * 4];
                float[] monoScratch = new float[TargetSampleRate];
                double resamplePos = 0.0;

                Stopwatch silenceWatch = Stopwatch.StartNew();
                Stopwatch parentWatch = Stopwatch.StartNew();
                Stopwatch deviceWatch = Stopwatch.StartNew();

                while (true)
                {
                    if (parentProcess != null && parentWatch.ElapsedMilliseconds >= 500)
                    {
                        parentWatch.Restart();
                        bool exited = false;
                        try { exited = parentProcess.HasExited; } catch { exited = true; }
                        if (exited) return 0;
                    }

                    if (deviceWatch.ElapsedMilliseconds >= 1500)
                    {
                        deviceWatch.Restart();
                        IMMDevice currentDefault;
                        if (enumerator.GetDefaultAudioEndpoint(ERender, EConsole, out currentDefault) == 0 && currentDefault != null)
                        {
                            string currentId = null;
                            try { currentDefault.GetId(out currentId); }
                            finally { Marshal.ReleaseComObject(currentDefault); }

                            if (!string.IsNullOrEmpty(currentId) && currentId != session.DeviceId)
                            {
                                session.Dispose();
                                int reopenHr;
                                session = OpenLoopbackSession(enumerator, out reopenHr);
                                if (session == null)
                                {
                                    WriteError("ERROR:stopped code=" + reopenHr);
                                    return 3;
                                }
                                resamplePos = 0.0;
                            }
                        }
                    }

                    uint packetSize;
                    int hr = session.Capture.GetNextPacketSize(out packetSize);
                    if (hr != 0)
                    {
                        session.Dispose();
                        session = TryReopenWithRetry(enumerator, out hr);
                        if (session == null)
                        {
                            WriteError("ERROR:stopped code=" + hr);
                            return 3;
                        }
                        resamplePos = 0.0;
                        continue;
                    }

                    bool wroteAny = false;
                    while (packetSize > 0)
                    {
                        IntPtr dataPtr;
                        uint numFrames;
                        uint flags;
                        ulong devPos;
                        ulong qpcPos;
                        hr = session.Capture.GetBuffer(out dataPtr, out numFrames, out flags, out devPos, out qpcPos);
                        if (hr != 0) break;

                        try
                        {
                            if (numFrames > 0)
                            {
                                bool isSilent = (flags & BufferFlagSilent) != 0 || dataPtr == IntPtr.Zero;
                                WriteFrames(stdout, session, dataPtr, (int)numFrames, isSilent, ref outBuffer, ref monoScratch, ref resamplePos);
                                wroteAny = true;
                            }
                        }
                        finally
                        {
                            session.Capture.ReleaseBuffer(numFrames);
                        }

                        hr = session.Capture.GetNextPacketSize(out packetSize);
                        if (hr != 0) break;
                    }

                    if (wroteAny)
                    {
                        stdout.Flush();
                        silenceWatch.Restart();
                    }
                    else
                    {
                        if (silenceWatch.ElapsedMilliseconds >= 40)
                        {
                            stdout.Write(silenceBytes, 0, silenceBytes.Length);
                            stdout.Flush();
                            silenceWatch.Restart();
                        }
                        Thread.Sleep(10);
                    }
                }
            }
            catch (IOException)
            {
                // Parent closed pipe.
                return 0;
            }
            catch (Exception ex)
            {
                WriteError("ERROR:capture code=" + ex.HResult);
                return 1;
            }
            finally
            {
                if (session != null) session.Dispose();
                if (enumerator != null) Marshal.ReleaseComObject(enumerator);
            }
        }

        private static LoopbackSession TryReopenWithRetry(IMMDeviceEnumerator enumerator, out int lastHr)
        {
            lastHr = -1;
            for (int i = 0; i < 3; i++)
            {
                Thread.Sleep(150);
                LoopbackSession reopened = OpenLoopbackSession(enumerator, out lastHr);
                if (reopened != null) return reopened;
            }
            return null;
        }

        private static LoopbackSession OpenLoopbackSession(IMMDeviceEnumerator enumerator, out int hr)
        {
            IMMDevice device;
            hr = enumerator.GetDefaultAudioEndpoint(ERender, EConsole, out device);
            if (hr != 0 || device == null) return null;

            string deviceId = "";
            try { device.GetId(out deviceId); } catch { }

            object clientObj;
            Guid iidClient = IidAudioClient;
            hr = device.Activate(ref iidClient, ClsCtxAll, IntPtr.Zero, out clientObj);
            if (hr != 0 || clientObj == null)
            {
                Marshal.ReleaseComObject(device);
                return null;
            }

            IAudioClient client = (IAudioClient)clientObj;
            LoopbackSession session = new LoopbackSession();
            session.Device = device;
            session.Client = client;
            session.DeviceId = deviceId;

            // Preferred path: ask Windows Audio Engine to deliver 48kHz mono 32-bit float directly.
            WAVEFORMATEX preferred = new WAVEFORMATEX();
            preferred.wFormatTag = 3; // WAVE_FORMAT_IEEE_FLOAT
            preferred.nChannels = 1;
            preferred.nSamplesPerSec = TargetSampleRate;
            preferred.wBitsPerSample = 32;
            preferred.nBlockAlign = 4;
            preferred.nAvgBytesPerSec = TargetSampleRate * 4u;
            preferred.cbSize = 0;

            IntPtr preferredPtr = Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(WAVEFORMATEX)));
            try
            {
                Marshal.StructureToPtr(preferred, preferredPtr, false);
                hr = client.Initialize(
                    0,
                    StreamFlagsLoopback | StreamFlagsAutoConvertPcm | StreamFlagsSrcDefaultQuality,
                    1000000L, // 100ms
                    0,
                    preferredPtr,
                    IntPtr.Zero
                );
            }
            finally
            {
                Marshal.FreeCoTaskMem(preferredPtr);
            }

            if (hr == 0)
            {
                session.Channels = 1;
                session.SampleRate = TargetSampleRate;
                session.BitsPerSample = 32;
                session.IsFloat = true;
                session.Direct48kMonoFloat = true;
            }
            else
            {
                IntPtr mixPtr;
                hr = client.GetMixFormat(out mixPtr);
                if (hr != 0 || mixPtr == IntPtr.Zero)
                {
                    session.Dispose();
                    return null;
                }
                try
                {
                    WAVEFORMATEX mix = (WAVEFORMATEX)Marshal.PtrToStructure(mixPtr, typeof(WAVEFORMATEX));
                    bool isFloat = mix.wFormatTag == 3;
                    bool isPcm = mix.wFormatTag == 1;
                    if (mix.wFormatTag == 0xFFFE && mix.cbSize >= 22)
                    {
                        byte[] guidBytes = new byte[16];
                        Marshal.Copy(IntPtr.Add(mixPtr, 24), guidBytes, 0, 16);
                        Guid subFormat = new Guid(guidBytes);
                        isFloat = subFormat == SubTypeIeeeFloat;
                        isPcm = subFormat == SubTypePcm;
                    }
                    if ((!isFloat && !isPcm) || mix.nChannels < 1 || mix.nSamplesPerSec < 8000)
                    {
                        WriteError("ERROR:pcm channels=" + mix.nChannels + " bits=" + mix.wBitsPerSample + " rate=" + mix.nSamplesPerSec);
                        session.Dispose();
                        hr = -2;
                        return null;
                    }

                    hr = client.Initialize(0, StreamFlagsLoopback, 1000000L, 0, mixPtr, IntPtr.Zero);
                    if (hr != 0)
                    {
                        session.Dispose();
                        return null;
                    }
                    session.Channels = mix.nChannels;
                    session.SampleRate = (int)mix.nSamplesPerSec;
                    session.BitsPerSample = mix.wBitsPerSample;
                    session.IsFloat = isFloat;
                    session.Direct48kMonoFloat = (isFloat && mix.nChannels == 1 && mix.nSamplesPerSec == TargetSampleRate && mix.wBitsPerSample == 32);
                }
                finally
                {
                    Marshal.FreeCoTaskMem(mixPtr);
                }
            }

            object captureObj;
            Guid iidCapture = IidAudioCaptureClient;
            hr = client.GetService(ref iidCapture, out captureObj);
            if (hr != 0 || captureObj == null)
            {
                session.Dispose();
                return null;
            }
            session.Capture = (IAudioCaptureClient)captureObj;

            hr = client.Start();
            if (hr != 0)
            {
                session.Dispose();
                return null;
            }
            return session;
        }

        private static unsafe void WriteFrames(
            Stream stdout,
            LoopbackSession session,
            IntPtr dataPtr,
            int frames,
            bool isSilent,
            ref byte[] outBuffer,
            ref float[] monoScratch,
            ref double resamplePos)
        {
            if (session.Direct48kMonoFloat)
            {
                int byteCount = frames * 4;
                if (outBuffer.Length < byteCount) outBuffer = new byte[byteCount];
                if (isSilent)
                {
                    Array.Clear(outBuffer, 0, byteCount);
                }
                else
                {
                    Marshal.Copy(dataPtr, outBuffer, 0, byteCount);
                }
                stdout.Write(outBuffer, 0, byteCount);
                return;
            }

            if (monoScratch.Length < frames) monoScratch = new float[frames];
            if (isSilent)
            {
                Array.Clear(monoScratch, 0, frames);
            }
            else
            {
                int ch = session.Channels;
                if (session.IsFloat && session.BitsPerSample == 32)
                {
                    float* src = (float*)dataPtr.ToPointer();
                    for (int i = 0; i < frames; i++)
                    {
                        float sum = 0f;
                        int baseIdx = i * ch;
                        for (int c = 0; c < ch; c++) sum += src[baseIdx + c];
                        float v = sum / ch;
                        if (float.IsNaN(v) || float.IsInfinity(v)) v = 0f;
                        monoScratch[i] = v;
                    }
                }
                else if (!session.IsFloat && session.BitsPerSample == 16)
                {
                    short* src = (short*)dataPtr.ToPointer();
                    for (int i = 0; i < frames; i++)
                    {
                        float sum = 0f;
                        int baseIdx = i * ch;
                        for (int c = 0; c < ch; c++) sum += src[baseIdx + c] / 32768f;
                        monoScratch[i] = sum / ch;
                    }
                }
                else if (!session.IsFloat && session.BitsPerSample == 32)
                {
                    int* src = (int*)dataPtr.ToPointer();
                    for (int i = 0; i < frames; i++)
                    {
                        double sum = 0.0;
                        int baseIdx = i * ch;
                        for (int c = 0; c < ch; c++) sum += src[baseIdx + c] / 2147483648.0;
                        monoScratch[i] = (float)(sum / ch);
                    }
                }
                else
                {
                    Array.Clear(monoScratch, 0, frames);
                }
            }

            if (session.SampleRate == TargetSampleRate)
            {
                int byteCount = frames * 4;
                if (outBuffer.Length < byteCount) outBuffer = new byte[byteCount];
                Buffer.BlockCopy(monoScratch, 0, outBuffer, 0, byteCount);
                stdout.Write(outBuffer, 0, byteCount);
                return;
            }

            double step = (double)session.SampleRate / TargetSampleRate;
            int maxOutFrames = (int)Math.Ceiling(frames / step) + 4;
            if (outBuffer.Length < maxOutFrames * 4) outBuffer = new byte[maxOutFrames * 4];

            int outCount = 0;
            fixed (byte* dstBytes = outBuffer)
            {
                float* dst = (float*)dstBytes;
                while (resamplePos < frames)
                {
                    int idx = (int)resamplePos;
                    double frac = resamplePos - idx;
                    float s0 = monoScratch[idx];
                    float s1 = (idx + 1 < frames) ? monoScratch[idx + 1] : s0;
                    dst[outCount++] = (float)(s0 + (s1 - s0) * frac);
                    resamplePos += step;
                }
            }
            resamplePos -= frames;
            if (resamplePos < 0.0) resamplePos = 0.0;

            if (outCount > 0)
            {
                stdout.Write(outBuffer, 0, outCount * 4);
            }
        }

        private static int ParseParentPid(string[] args)
        {
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--ppid")
                {
                    int pid;
                    if (int.TryParse(args[i + 1], out pid) && pid > 0) return pid;
                }
            }
            return 0;
        }

        private static void WriteError(string msg)
        {
            try
            {
                Console.Error.Write(msg + "\n");
                Console.Error.Flush();
            }
            catch { }
        }
    }
}
