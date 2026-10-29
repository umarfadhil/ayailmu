import CryptoKit
import Foundation
import Security

// Bounded private-QA policy. Loads only the generated public CA and binding from
// AyaPrivateQaTransportResources.bundle, validates requests, and evaluates a
// per-connection SecTrust against that single anchor. It never touches global
// trust, logs, creates certificates, or performs network calls.
internal struct PrivateQaPolicy {
  static let apiOrigin = "https://localhost:58444"
  static let authOrigin = "https://localhost:58445"

  private static let bundleName = "AyaPrivateQaTransportResources.bundle"
  private static let maxDerBytes = 64 * 1024
  private static let maxBindingBytes = 16 * 1024
  private static let maxUrlBytes = 8192
  private static let maxHeaderCount = 64
  private static let maxHeaderFieldBytes = 8192
  private static let maxHeaderTotalBytes = 32768
  private static let maxBodyBytes = 2 * 1024 * 1024
  private static let bindingKeys: Set<String> = ["enabled", "apiOrigin", "authOrigin", "caSha256"]
  private static let requestKeys: Set<String> = ["id", "url", "method", "headers", "body"]
  private static let idBytes = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-".utf8)
  private static let tokenBytes = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'*+-.^_`|~".utf8)
  private static let hexBytes = Set("0123456789abcdef".utf8)

  let certificate: SecCertificate
  let caSha256: String
  var binding: [String: Any] = [:]

  struct Prepared {
    let id: String
    let url: String
    let request: URLRequest
  }

  static func load() -> PrivateQaPolicy? {
    guard let root = Bundle.main.resourceURL?.appendingPathComponent(bundleName, isDirectory: true),
          let bundle = Bundle(url: root),
          let derUrl = bundle.url(forResource: "aya-private-qa-ca", withExtension: "der"),
          let bindingUrl = bundle.url(forResource: "aya-private-qa-binding", withExtension: "json"),
          let der = readBounded(derUrl, max: maxDerBytes),
          let bindingData = readBounded(bindingUrl, max: maxBindingBytes),
          let binding = parseBinding(bindingData),
          let hash = binding["caSha256"] as? String,
          sha256Hex(der) == hash,
          let certificate = SecCertificateCreateWithData(nil, der as CFData)
    else { return nil }
    return PrivateQaPolicy(certificate: certificate, caSha256: hash, binding: binding)
  }

  static func urlAllowed(_ raw: String) -> Bool {
    let bytes = Array(raw.utf8)
    guard !bytes.isEmpty, bytes.count <= maxUrlBytes,
          bytes.allSatisfy({ $0 >= 0x21 && $0 <= 0x7e && $0 != 0x23 && $0 != 0x5c })
    else { return false }
    let expectedPort: Int
    let rest: Substring
    if raw.hasPrefix(apiOrigin) {
      expectedPort = 58444
      rest = raw.dropFirst(apiOrigin.count)
    } else if raw.hasPrefix(authOrigin) {
      expectedPort = 58445
      rest = raw.dropFirst(authOrigin.count)
    } else {
      return false
    }
    guard rest.isEmpty || rest.hasPrefix("/") || rest.hasPrefix("?"),
          let url = URL(string: raw),
          url.scheme == "https", url.host == "localhost", url.port == expectedPort,
          url.user == nil, url.password == nil, url.fragment == nil,
          url.absoluteString == raw
    else { return false }
    return true
  }

  static func prepare(_ input: [String: Any]) -> Prepared? {
    guard Set(input.keys) == requestKeys,
          let id = input["id"] as? String, !id.isEmpty, id.utf8.count <= 128,
          id.utf8.allSatisfy({ idBytes.contains($0) }),
          let raw = input["url"] as? String, urlAllowed(raw), let url = URL(string: raw),
          let method = input["method"] as? String, !method.isEmpty, method.utf8.count <= 16,
          method.utf8.allSatisfy({ $0 >= 0x41 && $0 <= 0x5a }),
          let headers = input["headers"] as? [String: String], headers.count <= maxHeaderCount
    else { return nil }

    var seen = Set<String>()
    var total = 0
    for (name, value) in headers {
      let lower = name.lowercased()
      let nameCount = name.utf8.count
      let valueCount = value.utf8.count
      total += nameCount + valueCount
      guard nameCount > 0, nameCount <= maxHeaderFieldBytes, valueCount <= maxHeaderFieldBytes,
            name.utf8.allSatisfy({ tokenBytes.contains($0) }),
            !value.utf8.contains(where: { $0 == 0x0d || $0 == 0x0a || $0 == 0x00 }),
            lower != "host", lower != "cookie", seen.insert(lower).inserted
      else { return nil }
    }
    guard total <= maxHeaderTotalBytes else { return nil }

    var body: Data?
    switch input["body"] {
    case is NSNull:
      body = nil
    case let text as String:
      let data = Data(text.utf8)
      guard method != "GET", method != "HEAD", data.count <= maxBodyBytes,
            (try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)) != nil
      else { return nil }
      body = data
    default:
      return nil
    }

    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    request.httpMethod = method
    request.httpShouldHandleCookies = false
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    request.httpBody = body
    return Prepared(id: id, url: raw, request: request)
  }

  func accept(_ trust: SecTrust, host: String, port: Int) -> Bool {
    guard host == "localhost", port == 58444 || port == 58445 else { return false }
    let policy = SecPolicyCreateSSL(true, "localhost" as CFString)
    guard SecTrustSetPolicies(trust, policy) == errSecSuccess,
          SecTrustSetAnchorCertificates(trust, [certificate] as CFArray) == errSecSuccess,
          SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
          SecTrustSetNetworkFetchAllowed(trust, false) == errSecSuccess
    else { return false }
    var error: CFError?
    return SecTrustEvaluateWithError(trust, &error)
  }

  private static func readBounded(_ url: URL, max: Int) -> Data? {
    guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
          values.isRegularFile == true, let size = values.fileSize, size > 0, size <= max,
          let data = try? Data(contentsOf: url), !data.isEmpty, data.count <= max
    else { return nil }
    return data
  }

  private static func parseBinding(_ data: Data) -> [String: Any]? {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(object.keys) == bindingKeys,
          let enabled = object["enabled"] as? NSNumber,
          CFGetTypeID(enabled) == CFBooleanGetTypeID(), enabled.boolValue,
          object["apiOrigin"] as? String == apiOrigin,
          object["authOrigin"] as? String == authOrigin,
          let hash = object["caSha256"] as? String, hash.utf8.count == 64,
          hash.utf8.allSatisfy({ hexBytes.contains($0) })
    else { return nil }
    return object
  }

  private static func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
