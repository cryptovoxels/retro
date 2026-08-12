# big cleanup day: home, chat, map, and the little world in the corner

we shipped a lot of small fixes today. none of them are flashy on their own, but together they make voxels feel less like a website with a game bolted on and more like one place. here's what changed and why we bothered.

## the home page is the world now

voxels.com and /play used to be two different things pretending not to know each other. now the world renders full-bleed right on the home page, the site nav folds into a hamburger, and the sidebar got quieter (grey close button, no rounded corners cutting into the canvas). the reason is simple: the first thing you should see is the world, not chrome around a rectangle.

## the mini world in the corner

when you leave /play to read a profile or the blog, the world doesn't die anymore - it parks itself in a little dock at the bottom left. click it to jump back in, hit the x to let it go.

it also actually shows the world now. for a while the dock was painting its own background on top of the canvas, so all you got was a blank square with an x. the world was rendering the whole time, just hidden behind a solid rectangle. one background removed and there it is, your parcel idling in the corner while you read.

## chat learned some manners

chat used to sit on top of the world forever. now it fades out when nobody's talking and comes back when you click in. sending a message no longer wipes your history - it fades on the same clock instead of vanishing the moment you hit enter.

on phones the keyboard eats most of the screen, so chat keeps just the last 4 lines while you type, and when you close the keyboard safari gets scrolled back where it belongs instead of stranding you mid-page.

## the map points north

the map was rendering at whatever angle your camera happened to be facing, which is a fun way to get lost. it's north-up now, like maps are supposed to be. the "where am i" view stays wide with an arrow marking you, and the land-for-sale button moved out from under the hamburger so you can actually press it.

## reading the blog without leaving

blog posts open in a readable column instead of sprawling across the whole window, and on the home page they open right in the sidebar - you can read the news while standing in the world. clicking a post no longer dumps you onto a separate page.

## smaller but real

- **sign links work again.** clicking a hyperlink on a sign does the thing now.
- **third-person zoom is back.** scroll wheel pulls the camera out again instead of being pinned at arm's length.
- **guests see a guest ui.** logged out? the build tools are gone and there's a login button where they were. no point showing you tools you can't use.
- **profiles got see-all links.** parcels, collaborations, and spaces don't get cut off anymore.
- **the ui=off flag works again.** it's been in the docs (and in our go-live links) all along, but nothing was listening. add &ui=off to a /play url and you get a clean world with no hud and no crosshair - good for filming, streaming, and embeds.
- **sidebar buttons fade while you walk**, so the world gets the screen when you're moving.

## why the flurry

most of these were paper cuts - things that were 90% right and 10% annoying. paper cuts are cheap to fix one at a time and expensive to live with forever. the code that came out of today is also smaller than the code that went in, which is the direction we like.
