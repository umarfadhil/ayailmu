import Foundation
import Security
import AyaIlmuCore
/// HTTPS only, no cookies, no caching, no redirects. Uses the system trust store.
final class AppTransport: NSObject, HTTPTransport, URLSessionTaskDelegate, @unchecked Sendable {
    private var session: URLSession!
    override init() {
        super.init(); let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 10; c.timeoutIntervalForResource = 20; c.httpCookieStorage = nil; c.urlCache = nil; c.httpShouldSetCookies = false
        session = URLSession(configuration:c,delegate:self,delegateQueue:nil)
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session:URLSession,didReceive challenge:URLAuthenticationChallenge,completionHandler:@escaping (URLSession.AuthChallengeDisposition,URLCredential?) -> Void) {
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
}
