import XCTest
@testable import AyaIlmuCore
final class AccountFormValidationTests: XCTestCase {
    func testSignupListsRequirementsAndRejectsMismatch() {
        let errors = AccountFormValidation.messages(mode:.signup, email:"bad", password:"short", confirmation:"different", code:"", adult:false)
        XCTAssertEqual(errors.count, 4)
        XCTAssertTrue(errors.contains("Passwords must match."))
    }
    func testSignupAcceptsValidMatchingInputs() {
        XCTAssertTrue(AccountFormValidation.messages(mode:.signup, email:"test@example.invalid", password:"fixture-password", confirmation:"fixture-password", code:"", adult:true).isEmpty)
    }
    func testTwelveCharactersStillRequiresMatchingConfirmationAndAdultDeclaration() {
        let password = "twelve-chars"
        XCTAssertEqual(password.count,12)
        XCTAssertTrue(AccountFormValidation.messages(mode:.signup,email:"test@example.invalid",password:password,confirmation:password,code:"",adult:true).isEmpty)
        XCTAssertEqual(AccountFormValidation.messages(mode:.signup,email:"test@example.invalid",password:password,confirmation:"",code:"",adult:false),["Passwords must match.","Confirm the adult or guardian declaration."])
    }
    func testSignupPasswordLengthBoundaries() {
        for (length,accepted) in [(11,false),(12,true),(256,true),(257,false)] {
            let password = String(repeating:"x",count:length)
            let messages = AccountFormValidation.messages(mode:.signup,email:"test@example.invalid",password:password,confirmation:password,code:"",adult:true)
            XCTAssertEqual(messages.isEmpty,accepted,"Password length \(length)")
            XCTAssertEqual(AccountAPI.passwordValid(password),accepted)
        }
    }
    func testSignupControlCharactersMismatchAndAdultGateHaveSafeMessages() {
        let password = "twelve-chars"
        for control in ["\n","\r","\0"] {
            let value = String(password.prefix(11)) + control
            XCTAssertEqual(value.count,12)
            XCTAssertEqual(AccountFormValidation.messages(mode:.signup,email:"test@example.invalid",password:value,confirmation:value,code:"",adult:true),["Use a password of 12–256 characters without line breaks."])
        }
        let messages = AccountFormValidation.messages(mode:.signup,email:"private@example.invalid",password:password,confirmation:"other-secret",code:"",adult:false)
        XCTAssertEqual(messages,["Passwords must match.","Confirm the adult or guardian declaration."])
        for secret in [password,"other-secret","private@example.invalid"] {
            XCTAssertFalse(messages.contains { $0.contains(secret) })
        }
    }
    func testResetRequiresCodeAndMatchingPassword() {
        XCTAssertEqual(AccountFormValidation.messages(mode:.reset, email:"test@example.invalid", password:"fixture-password", confirmation:"wrong", code:"123", adult:false).count, 2)
    }
    func testLoginDoesNotRequireConfirmation() {
        XCTAssertTrue(AccountFormValidation.messages(mode:.login, email:"test@example.invalid", password:"fixture-password", confirmation:"", code:"", adult:true).isEmpty)
    }
    func testRecoverOnlyRequiresEmail() {
        XCTAssertTrue(AccountFormValidation.messages(mode:.recover, email:"test@example.invalid", password:"", confirmation:"", code:"", adult:false).isEmpty)
    }
    func testConfirmRequiresCodeAndAdult() {
        XCTAssertEqual(AccountFormValidation.messages(mode:.confirm, email:"test@example.invalid", password:"", confirmation:"", code:"123", adult:false).count, 2)
    }
}
