import { betaTerms } from '../legal';
import { LegalPage } from '../ui/LegalPage';

export default function TermsPage() {
  return <LegalPage document={betaTerms} />;
}
