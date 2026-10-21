import Foundation
import ScreenCaptureKit
import CoreMedia
import AudioToolbox
import CoreGraphics

@available(macOS 13.0, *)
final class AudioOutput: NSObject, SCStreamOutput, SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let format = sampleBuffer.formatDescription,
              let description = CMAudioFormatDescriptionGetStreamBasicDescription(format),
              let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        let audio = description.pointee
        guard audio.mChannelsPerFrame == 1, audio.mBitsPerChannel == 32,
              audio.mFormatFlags & kAudioFormatFlagIsFloat != 0, audio.mSampleRate == 48000 else {
            FileHandle.standardError.write(Data("ERROR:pcm channels=\(audio.mChannelsPerFrame) bits=\(audio.mBitsPerChannel) rate=\(audio.mSampleRate)\n".utf8)); exit(2)
        }
        let count = CMBlockBufferGetDataLength(block)
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { buffer in
            CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: count, destination: buffer.baseAddress!)
        }
        if status == kCMBlockBufferNoErr { FileHandle.standardOutput.write(data) }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("ERROR:stopped code=\((error as NSError).code)\n".utf8)); exit(3)
    }
}

@main struct SystemAudio {
    static func main() async {
        guard #available(macOS 13.0, *) else {
            FileHandle.standardError.write(Data("ERROR:macOS 13 required\n".utf8)); exit(4)
        }
        do {
            if !CGPreflightScreenCaptureAccess() && !CGRequestScreenCaptureAccess() {
                FileHandle.standardError.write(Data("ERROR:permission code=-3801\n".utf8)); exit(1)
            }
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else { throw NSError(domain: "NoDisplay", code: 1) }
            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let configuration = SCStreamConfiguration()
            configuration.width = 2; configuration.height = 2
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            configuration.capturesAudio = true
            configuration.excludesCurrentProcessAudio = true
            configuration.sampleRate = 48000; configuration.channelCount = 1
            let output = AudioOutput()
            let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
            try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: DispatchQueue(label: "interview.audio"))
            try await stream.startCapture()
            FileHandle.standardError.write(Data("READY\n".utf8))
            // Keep stream and delegate alive; parent owns this child process lifecycle.
            while true { try await Task.sleep(nanoseconds: 1_000_000_000); if getppid() == 1 { exit(0) }; _ = stream; _ = output }
        } catch {
            let code = (error as NSError).code
            FileHandle.standardError.write(Data("ERROR:\(code == -3801 ? "permission" : "capture") code=\(code)\n".utf8)); exit(1)
        }
    }
}
