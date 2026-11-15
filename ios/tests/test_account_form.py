import pathlib, unittest

view = (pathlib.Path(__file__).resolve().parents[1] / 'AyaIlmu/AccountView.swift').read_text()
class AccountFormRegression(unittest.TestCase):
    def test_confirmation_field_signup_and_reset(self):
        self.assertIn('SecureField("Confirm password",text:$confirmPassword)', view)
        self.assertIn('AccountFormValidation', view)
    def test_focus_and_keyboard_controls(self):
        self.assertIn('@FocusState private var focused: AccountField?', view)
        self.assertIn('.focused($focused, equals:.email)', view)
        self.assertIn('ToolbarItemGroup(placement:.keyboard)', view)
    def test_submit_guards_and_feedback(self):
        self.assertIn('guard !model.busy, valid else { return }', view)
        self.assertIn('validationMessages', view)

class AccountFeedbackLayoutRegression(unittest.TestCase):
    def test_feedback_is_in_submit_group_before_mode_links_and_learning(self):
        button = view.index('Button { focused = nil; submit() }')
        feedback = view.index('accountFeedback',button)
        links = view.index('ForEach(AccountMode.allCases',button)
        learning = view.index('contentAvailability',links)
        self.assertLess(button,feedback)
        self.assertLess(feedback,links)
        self.assertLess(feedback,learning)
    def test_immediate_progress_and_scroll_for_status_and_error(self):
        self.assertIn('model.busy || submitting',view)
        self.assertIn('if operationInProgress { ProgressView()',view)
        self.assertIn('Text(operationInProgress ? progressTitle : actionTitle)',view)
        self.assertIn('.onChange(of: operationInProgress)',view)
        self.assertIn('.onChange(of: model.message)',view)
        self.assertIn('if (active && submitting) || (!active && !model.message.isEmpty)',view)
        self.assertIn('Text(L(model.message)).font(.callout).fixedSize(horizontal:false,vertical:true)',view)
        self.assertIn('scroll.scrollTo("account.feedback",anchor:.center)',view)
        self.assertIn('.disabled(operationInProgress || !valid)',view)
    def test_startup_restore_does_not_scroll_but_submission_and_final_feedback_do(self):
        transition = view[view.index('.onChange(of: operationInProgress)'):view.index('.onChange(of: model.message)')]
        self.assertIn('(active && submitting)',transition)
        self.assertIn('(!active && !model.message.isEmpty)',transition)
        self.assertNotIn('if active ||',transition)
        self.assertNotIn('if active {',transition)
    def test_failure_retains_form_but_success_and_mode_change_clear_secrets(self):
        success = view[view.index('let success = await model.run'):view.index('private struct LearningView')]
        self.assertIn('if success {\n            clearSecrets()',success)
        self.assertNotIn('password = ""',success)
        self.assertIn('mode = destination; focused = nil; clearSecrets()',view)
        self.assertIn('Button("Sign out") { clearSecrets();',view)
        self.assertIn('Button("Sign in again with password") { clearSecrets();',view)
    def test_submit_captures_values_and_guards_repeat_before_task(self):
        submit = view[view.index('private func submit()'):view.index('private struct LearningView')]
        self.assertLess(submit.index('guard !submitting'),submit.index('submitting = true'))
        self.assertLess(submit.index('submitting = true'),submit.index('Task {'))
        self.assertIn('let submittedEmail = email, submittedPassword = password',submit)
        self.assertIn('defer { submitting = false }',submit)

if __name__ == '__main__': unittest.main()
