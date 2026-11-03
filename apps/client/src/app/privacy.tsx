import { privacyPolicy } from '../legal';
import { LegalPage } from '../ui/LegalPage';

export default function PrivacyPage() {
  return <LegalPage document={privacyPolicy} />;
}
