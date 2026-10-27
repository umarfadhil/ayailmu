#if PRIVATE_OWNER_QA && !DEBUG
#error("PRIVATE_OWNER_QA is forbidden outside Debug")
#endif
import Foundation
import Security
import CryptoKit
import AyaIlmuCore
/// Debug build only, one build-supplied public CA, one exact TLS origin. Never changes OS trust.
final class AppTransport: NSObject, HTTPTransport, URLSessionTaskDelegate, @unchecked Sendable {
    private var session: URLSession!
    override init() {
        super.init(); let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 10; c.timeoutIntervalForResource = 20; c.httpCookieStorage = nil; c.urlCache = nil; c.httpShouldSetCookies = false
        session = URLSession(configuration:c,delegate:self,delegateQueue:nil)
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session:URLSession,didReceive challenge:URLAuthenticationChallenge,completionHandler:@escaping (URLSession.AuthChallengeDisposition,URLCredential?) -> Void) {
        #if DEBUG && PRIVATE_OWNER_QA
        let space = challenge.protectionSpace
        NSLog("AyaIlmuTLS challenge host=%@ port=%ld protocol=%@ method=%@",space.host,space.port,space.protocol ?? "nil",space.authenticationMethod)
        if space.authenticationMethod == NSURLAuthenticationMethodServerTrust, space.host == "localhost", space.port == 58443, space.protocol == "https" {
            guard let trust = space.serverTrust, let url = Bundle.main.url(forResource:"PrivateOwnerCA",withExtension:"der"), let data = try? Data(contentsOf:url), SHA256.hash(data:data).map({String(format:"%02x",$0)}).joined() == "75bf582db974accb5b4ed74936c8477fa6a6fc94f5d2ca33d8500b224f1ffbd0", let ca = SecCertificateCreateWithData(nil,data as CFData) else { completionHandler(.cancelAuthenticationChallenge,nil); return }
            var trustError: CFError?
            guard SecTrustSetPolicies(trust,SecPolicyCreateSSL(true,"localhost" as CFString)) == errSecSuccess, SecTrustSetAnchorCertificates(trust,[ca] as CFArray) == errSecSuccess, SecTrustSetAnchorCertificatesOnly(trust,true) == errSecSuccess, SecTrustEvaluateWithError(trust,&trustError) else { NSLog("AyaIlmuTLS trust evaluation failed %@",String(describing:trustError)); completionHandler(.cancelAuthenticationChallenge,nil); return }
            completionHandler(.useCredential,URLCredential(trust:trust)); return
        }
        #endif
        completionHandler(.performDefaultHandling,nil)
    }
    func urlSession(_ session:URLSession, task:URLSessionTask, didReceive challenge:URLAuthenticationChallenge, completionHandler:@escaping (URLSession.AuthChallengeDisposition,URLCredential?) -> Void) {
        self.urlSession(session,didReceive:challenge,completionHandler:completionHandler)
    }
    func send(_ request:URLRequest) async throws -> HTTPReply {
        guard request.url?.scheme == "https" else { throw AccountError.configuration }
        let (bytes,response) = try await session.bytes(for:request,delegate:self)
        guard let http = response as? HTTPURLResponse else { throw AccountError.invalidResponse }
        guard !(300...399).contains(http.statusCode) else { throw AccountError.redirect }
        var data = Data(); for try await byte in bytes { guard data.count < 4194304 else { throw AccountError.tooLarge }; data.append(byte) }
        return HTTPReply(status:http.statusCode,data:data)
    }
    #if DEBUG && PRIVATE_OWNER_QA
    /// No credentials, bodies or auth endpoints with side effects; opt-in process instrumentation only.
    func probe() async {
        var results: [String] = []
        for (label,url,expected) in [("health","https://localhost:58443/healthz",200),("protected-user","https://localhost:58443/user",401)] {
            do { let r = try await send(URLRequest(url:URL(string:url)!)); results.append("\(label):\(r.status == expected ? "PASS" : "FAIL") status=\(r.status)") } catch { let e = error as NSError; results.append("\(label):FAIL transport domain=\(e.domain) code=\(e.code)") }
        }
        for (label,url) in [("cleartext","http://localhost:58443/healthz"),("wrong-host","https://127.0.0.1:58443/healthz")] {
            do { _ = try await send(URLRequest(url:URL(string:url)!)); results.append("\(label):FAIL accepted") } catch { results.append("\(label):PASS rejected") }
        }
        if let documents = FileManager.default.urls(for:.documentDirectory,in:.userDomainMask).first { try? results.joined(separator:"\n").write(to:documents.appendingPathComponent("NoMailProbe.txt"),atomically:true,encoding:.utf8) }
        results.forEach { NSLog("AyaIlmuNoMailProbe %@",$0) }
    }
    #endif
}
