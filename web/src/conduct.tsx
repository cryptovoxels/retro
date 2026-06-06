import { Component } from 'preact'
import Head from './components/head'

export default class Conduct extends Component<any, any> {
  render() {
    return (
      <section>
        <Head title={`Code of Conduct`} />
        <h2>Voxels Code of Conduct</h2>
        <aside>
          <h4>Table of contents</h4>
          <ol>
            <li value="1">Concerning all Voxels related social services</li>
            <li value="2">
              In-world specific
              <ol type="a">
                <li value="1">Parcel Builds</li>
                <li value="2">Womps (in world bookmarks)</li>
              </ol>
            </li>
            <li value="3">Wearables specific</li>
            <li value="4">Future changes to Code of Conduct</li>
          </ol>
          <div>
            <img src="/images/excellent.webp" width="200" />
            <p>
              <em>
                <strong>TL;DR</strong> Be excellent to each other!
              </em>
            </p>
          </div>
        </aside>
        <section>
          <h3>1. Concerning all Voxels related social services</h3>
          <p>General Voxels-related social services include the Voxels website, Voxels in-world builds &amp; interactions, and third-parties provided services such as the Voxels discord server and the Voxels sub-reddit.</p>
          <p>
            You are free to express yourself however you like and we encourage debates, polls and community discussions. However, in all services mentioned above, we expect you to be kind and respectful to other members of the community.
          </p>

          <h4>
            The following behavior <em>is not tolerated</em> and may result in a ban on discord and/or suspension of your build/chat rights in world:
          </h4>

          <ul>
            <li>
              <strong>Harassment</strong>
              <ul>
                <li>Repeatedly approaching an individual with the intent to disturb or upset</li>
                <li>Reaching into other services or channels to continue harassing an individual after being blocked</li>
              </ul>
            </li>

            <li>
              <strong>Intolerance</strong>
              <ul>
                <li>Hate speech including language, symbols and actions</li>
                <li>Discrimination towards specific belief, gender, sexual orientation, sexual identity or disability</li>
              </ul>
            </li>

            <li>
              <strong>Impersonation</strong>
              <ul>
                <li>Impersonating a Voxels staff or moderator</li>
                <li>Falsifying and stealing someone else's virtual or real identity</li>
              </ul>
            </li>

            <li>
              <strong>Inappropriate content</strong>
              <ul>
                <li>
                  Any NSFW content, whether it is a picture, video, text, vox, or audio is not permitted. This holds true for any of the general means of socialization EXCEPT #nsfw-beta on discord.
                  <br />
                  <em>Some NSFW NFTs are considered "Art" and in this case we call for the owner to address the controversial aspect of their own art to the community or to the moderators. The NFTs fate will then be decided there.</em>
                </li>
                <li>Any realistic depictions of guns are not permitted in world</li>
              </ul>
            </li>
          </ul>
        </section>
        <section>
          <h3>2. In-world specific</h3>

          <p>We expect you to behave as you would want others to behave toward you.</p>
          <h4>2.a Parcel Builds</h4>
          <p>
            We do not allow builds featuring <strong>inappropriate content</strong> as specified above. The main reason for this is to allow Cyptovoxels to make your content available to the general public (e.g. app stores) without any
            barriers to access.
          </p>
          <p>You are allowed to place features outside your parcel's boundaries to a respectable extent. Here are some recommendations as to what you can do:</p>
          <ul>
            <li>Height-wise you may go 5 meters above your parcel height (one voxel block = 0.5m)</li>
            <li>Streetside-wise you may go half a street outside your parcel</li>
            <li>You should not place content in parcels that you do not own without permission</li>
            <li>If your parcel is on a waterfront, you may extend 5 meters out into the water</li>
          </ul>
          <p>
            <em>
              These are recommendations. We expect you to communicate with your neighbors and enter into an agreement on what is respectable for your neighborhood. Please note that while the build tools don't currently enforce out-of-parcel
              content position, we may choose to add this at a later stage
            </em>
          </p>

          <h4>2.b Womps (in-world screenshot bookmarks)</h4>

          <p>While you are free to use womps however you like, we expect you to not abuse it. For example, trying to take over the front page is considered abuse.</p>
        </section>

        <section>
          <h3>3. Wearables</h3>
          <p>
            You are free to use your wearable however you like. However, remember that depending on the way you wear a Wearable it may make someone else uncomfortable. Vox models that are considered NSFW or that are too similar to
            real-world weapons are not permitted.
          </p>
        </section>

        <section>
          <h3>4. Future changes to Code of Conduct</h3>
          <p>
            Voxels may revise this code of conduct in the future as we identify room for improvement. It is your responsibility to make sure that you keep up to date with changes. However we will do our best to communicate any important
            changes with the community on our{' '}
            <a target="_blank" href="https://discord.gg/3RSCZGr3fr">
              Discord
            </a>{' '}
            and{' '}
            <a target="_blank" href="https://twitter.com/voxels">
              Twitter
            </a>
            .
          </p>
        </section>
      </section>
    )
  }
}
