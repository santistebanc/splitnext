// The public privacy policy and beta terms. This file is their only source:
// the /privacy and /terms pages render it, and docs/support-playbook.md links
// here. Keep it true to what the app stores and logs, described in
// docs/architecture.md.

export const supportEmail = 'support@splitnext.online';

export type LegalSection = {
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

export type LegalDocument = {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
};

export const privacyPolicy: LegalDocument = {
  title: 'Privacy policy',
  updated: 'November 3, 2026',
  intro:
    'Splitnext is a free public beta for keeping track of shared costs in small groups. It has no accounts, and it keeps only what a group needs to work.',
  sections: [
    {
      heading: 'What a group stores',
      paragraphs: [
        'Everyone in a group can see what is entered in it:',
      ],
      items: [
        'The group name and the names of the people in it.',
        'Expenses: description, amount, who paid, and how it is shared.',
        'Repayments between people.',
        'Activity: what changed, when, and which person made the change.',
        'The current invite link. Only a fingerprint (hash) of older links is kept, so an old link can say it was replaced.',
      ],
    },
    {
      heading: 'What identifies your device',
      paragraphs: [
        'The first time you open the app, your browser makes a random key for this installation. The server stores only a fingerprint (hash) of that key, a random id for the installation, and which groups it has joined or left. Names you type are not linked to anything outside the group.',
      ],
    },
    {
      heading: 'What stays on your device',
      paragraphs: [
        'Your browser keeps a copy of your groups so the app works offline, along with the installation key, the last group you opened, the name you last used for yourself, and which activity you have seen. Splitnext sets no cookies. Clearing this site’s data in your browser removes all of it, and with it this device’s access to your groups.',
      ],
    },
    {
      heading: 'Server logs',
      paragraphs: [
        'The server writes one log line per request so problems can be found and fixed: the kind of request, its result and timing, any error code, and installation and group ids. Log lines never contain names, descriptions, amounts, invite links, or keys. Our hosting provider also processes your IP address to deliver each request.',
      ],
    },
    {
      heading: 'What Splitnext does not collect',
      paragraphs: [
        'No email addresses, phone numbers, contacts, location, payment details, advertising ids, or analytics about how you use the app.',
      ],
    },
    {
      heading: 'Who processes the data',
      paragraphs: [
        'Splitnext runs on Cloudflare (Workers, Durable Objects and D1), which stores group data and logs on our behalf. Nothing is sold or shared with anyone else.',
      ],
    },
    {
      heading: 'Why, and how long',
      paragraphs: [
        'Group data is used only to show and synchronize the group, and logs only to keep the service working. Groups are kept until they are deleted on request or an announced beta reset. Inactive groups are not deleted automatically.',
      ],
    },
    {
      heading: 'Deleting a group',
      paragraphs: [
        'Leaving a group removes it from your device’s list, but the group stays for everyone else. To have a whole group erased, email ' +
          supportEmail +
          ' with:',
      ],
      items: [
        'The group’s invite link.',
        'The group name and at least two people’s names in it.',
        'Confirmation that deleting it removes it for everyone in the group.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You can ask what is stored about you, and ask for it to be corrected or erased. You can also complain to a data protection authority. Because there are no accounts, requests are checked with the group details above.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [`For privacy, deletion or support requests: ${supportEmail}.`],
    },
  ],
};

export const betaTerms: LegalDocument = {
  title: 'Beta terms',
  updated: 'November 3, 2026',
  intro:
    'Splitnext is free beta software for keeping track of shared costs in small groups. By using it you accept these terms.',
  sections: [
    {
      heading: 'Beta software',
      paragraphs: [
        'Splitnext may change, break, lose features, or be unavailable. Support is best effort and has no guaranteed response time.',
      ],
    },
    {
      heading: 'It only keeps track',
      paragraphs: [
        'Splitnext records what people enter and suggests repayments. It does not move or hold money, process payments, do accounting, or give financial advice. Check amounts yourself and pay outside the app.',
      ],
    },
    {
      heading: 'What people enter',
      paragraphs: [
        'Names, expenses and repayments are entered by the people in a group and may be wrong or out of date. Everyone in a group can change them, and every change appears in Activity.',
      ],
    },
    {
      heading: 'Invite links',
      paragraphs: [
        'Anyone with a group’s invite link can join it and see everything in it. Share it only with people you want in the group, and make a new link from the group if an old one reaches the wrong person.',
      ],
    },
    {
      heading: 'Access on your device',
      paragraphs: [
        'There are no accounts. Your access lives in this browser, so clearing its data or losing the device loses that access. Open a current invite link to join the group again.',
      ],
    },
    {
      heading: 'Availability and data',
      paragraphs: [
        'Group data is treated as real data and protected with care, but there is no guarantee of uptime or recovery, and no compensation for lost or incorrect data or downtime.',
      ],
    },
    {
      heading: 'Fair use',
      paragraphs: [
        'Do not abuse the service, guess invite links, scrape data, harass others, enter unlawful content, or interfere with other groups.',
      ],
    },
    {
      heading: 'Changes',
      paragraphs: [
        'The beta may change, reset, migrate or end. Changes that affect your data will be announced in advance when practical.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [`For support, privacy or deletion requests: ${supportEmail}.`],
    },
  ],
};
