# Secret (not really) flags

When you construct a URL to launch Voxels like so:

    https://www.voxels.com/play

There are a bunch of parameters you can put after `/play` to enable special modes of Voxels. This page tries to keep track of them. Add the
parameter with `/play?key=value` or combine modes with `/play?key1=value&key2=value&...`

## Coords

    &coords=NE@16N,15E,7U

Launch the world to this coordinate. Form is heading@latitude,longitude,altitude - with the correct suffixes for each term.

## Specify draw distance

This will adjust how far you can see and the amount of fog present. The higher the setting, the more powerful your computer will need to be
to get good framerates.

    &distance=512

You can specify the maximum view distance in meters, any number between 32 and 512 (128 is the default on desktop and 32 on mobile).

Or you can use `close`, `extended` or `far`.

    &distance=extended

## No ui mode

    &ui=off

Removes the reticule (crosshair) and the UI

## Override sidebar defaults

To hide the interact sidebar (and suppress Quick Start Guide):

    &interact=none

Show chat sidebar:

    &interact=chat

You can also specify `womp`, `emote`, `chat` or `welcome`

## Isolation mode

    &isolate=true

Loads only the parcel you are in and therefore isolates your parcel from the rest of the world.

## Mute audio

    &audio=off

Turn off (most) audio.

Audio is disabled by default on mobile. You can turn (most) of it on using `&audio=on`.

## Enable bot mode

    &bot=true

Don't start the render loop. Used for code that wants to control the camera and capture.

## Enable debug overlays

    &debug=true

Force debug mode.

## Inspect mode

    &inspect=true

## Spatial Voice Chat

Experimental: only works with headphones. Otherwise echoey feedback nightmares ensue.

    &voice=spatial

## Parcel highlight

    &parcel_highlight=enabled

Highlights the boundaries of the parcel you spawn in.
