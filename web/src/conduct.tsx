import { Component } from 'preact'
import Head from './components/head'

export default class Conduct extends Component<any, any> {
  render() {
    return (
      <section>
        <h2>Code of Conduct</h2>

        <div>
            <img src="/images/excellent.webp" width="320px" />
            <p>
              <b>
                TL;DR Be excellent to each other!
              </b>
            </p>
          </div>

        <section>
          <p>
            You are free to express yourself and we encourage debates, polls and community discussions. However, in all services mentioned above, we expect you to be kind and respectful to other members of the community.
            The following behavior <b>is not cool</b> and may get you banned my bros:
          </p>

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

          <p>We expect you to behave as you would want others to behave toward you.</p>

          <p>
            We do not allow builds featuring <strong>inappropriate content</strong> as specified above. The main reason for this is to allow Cyptovoxels to make your content available to the general public (e.g. app stores) without any
            barriers to access.
          </p>

          <h4>Parcels</h4>

          <p>You are allowed to place features outside your parcel's boundaries to a respectable extent. Here are some recommendations as to what you can do:</p>

          <ul>
            <li>Height-wise you may go 5 meters above your parcel height (one voxel block = 0.5m)</li>
            <li>Streetside-wise you may go half a street outside your parcel</li>
            <li>You should not place content in parcels that you do not own without permission</li>
            <li>If your parcel is on a waterfront, you may extend 5 meters out into the water</li>
          </ul>

          <p>
            These are recommendations. We expect you to communicate with your neighbors and enter into an agreement on what is respectable for your neighborhood.
          </p>

          <h3>Wearables</h3>

          <p>
            You are free to use your wearable however you like. However, remember that depending on the way you wear a Wearable it may make someone else uncomfortable. Vox models that are considered NSFW or that are too similar to
            real-world weapons are not permitted.
          </p>

          <h3>Changes to the Code of Conduct</h3>

          <p>
            Voxels may revise this code of conduct in the future as we identify room for improvement. It is your responsibility to make sure that you keep up to date with changes.           </p>
        </section>
      </section>
    )
  }
}
