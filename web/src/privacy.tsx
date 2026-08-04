import { Component } from 'preact'
import Head from './components/head'

const terms = `

Nolan Consulting Limited Privacy Policy

This Privacy Policy describes how your personal information is collected, used, and shared when you visit or make a purchase from https://www.voxels.com/ (the “Site”).

PERSONAL INFORMATION WE COLLECT

When you visit the Site, we automatically collect certain information about your device, including information about your web browser, IP address, time zone, and some of the cookies that are installed on your device. Additionally, as you browse the Site, we collect information about the individual web pages or products that you view, what websites or search terms referred you to the Site, and information about how you interact with the Site. We refer to this automatically-collected information as “Device Information.”

We collect Device Information using the following technologies:

    - “Cookies” are data files that are placed on your device or computer and often include an anonymous unique identifier. For more information about cookies, and how to disable cookies, visit http://www.allaboutcookies.org.
    - “Log files” track actions occurring on the Site, and collect data including your IP address, browser type, Internet service provider, referring/exit pages, and date/time stamps.

Additionally we may collect your web3 wallet address if you grant us permission.

When we talk about “Personal Information” in this Privacy Policy, we are talking both about Device Information and Order Information.

HOW DO WE USE YOUR PERSONAL INFORMATION?

We use the Device Information that we collect to help us screen for potential risk and fraud (in particular, your IP address), and more generally to improve and optimize our Site (for example, by generating analytics about how our customers browse and interact with the Site, and to assess the success of our marketing and advertising campaigns).

SHARING YOUR PERSONAL INFORMATION

We may share your Personal Information to comply with applicable laws and regulations, to respond to a subpoena, search warrant or other lawful request for information we receive, or to otherwise protect our rights.

DO NOT TRACK

Please note that we do not alter our Site’s data collection and use practices when we see a Do Not Track signal from your browser.

YOUR RIGHTS

If you are a European resident, you have the right to access personal information we hold about you and to ask that your personal information be corrected, updated, or deleted. If you would like to exercise this right, please contact us through the contact information below.

MINORS

The Site is not intended for individuals under the age of 13.

CHANGES

We may update this privacy policy from time to time in order to reflect, for example, changes to our practices or for other operational, legal or regulatory reasons.

CONTACT US

For more information about our privacy practices, if you have questions, or if you would like to make a complaint, please contact us by e-mail at support@cryptovoxels.com.

`

export default class Privacy extends Component<any, any> {
  render() {
    const __html = terms.replace(/\n/g, '<br />')

    return (
      <section>
        <Head title="Privacy Policy" />

        <h1>Privacy Policy</h1>

        <p>
          By using Voxels you agree to the privacy policy below, and the <a href="/conduct">Code of Conduct</a>
        </p>

        <div dangerouslySetInnerHTML={{ __html }} />
      </section>
    )
  }
}
