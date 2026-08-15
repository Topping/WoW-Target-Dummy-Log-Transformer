<div align="center">

# WoW Dummy Log Converter

**Turn a World of Warcraft target-dummy session into an encounter log you can
upload and analyze.**

[Open the converter](https://topping.github.io/WoW-Target-Dummy-Log-Transformer/)

</div>

![WoW Dummy Log Converter walkthrough](assets/product-demo.gif)

## Make your target-dummy sessions useful

Target dummies are great for testing a rotation, comparing builds, and
practicing a spec. Their combat logs are less useful: without a real encounter,
the usual Warcraft Logs and analysis workflow cannot treat the session like a
fight.

WoW Dummy Log Converter finds your meaningful training attempt inside the
combat log and turns it into an encounter-style `.txt` file. Upload that file to
Warcraft Logs as **Unlisted**, then use the resulting report with the encounter
analysis tool of your choice.

## What it does

- Finds the character who recorded the log.
- Separates deliberate attempts from short or unrelated interactions.
- Filters surrounding player activity out of the selected attempt.
- Keeps the recorded timing, combat events, targets, pets, and controlled
  entities.
- Handles both single-target and cleave-dummy sessions.
- Adds character, specialization, talent, and equipment details from `/simc`.
- Produces an encounter log for the unlisted Warcraft Logs upload flow.

The converter does not simulate your rotation or invent damage events. It gives
the combat you actually recorded the encounter structure expected by downstream
tools.

## Upload as Unlisted

The generated file is an analysis-only synthetic encounter. When uploading it
to Warcraft Logs, choose **Unlisted** visibility in the Archon desktop client.
An unlisted report is available through its direct link for use with analysis
tools, but it does not enter public rankings.

Do not publish the generated report or use it for rankings.

## How to use it

1. Install the SimulationCraft addon before recording.
2. Enable combat logging and perform your target-dummy attempt.
3. Open the converter and choose your `WoWCombatLog.txt` file.
4. Paste the complete text output from `/simc` into **Character profile**.
5. Download the generated encounter-log `.txt` file.
6. Upload it to Warcraft Logs as **Unlisted** with the Archon desktop client,
   then open the report in your preferred analysis tool.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Run the complete verification suite and production build:

```sh
npm run verify
npm run build
```

Record the product walkthrough used above:

```sh
npm run demo:record
```

The recorder writes WebM and GIF versions to `demo-output/` and refreshes the
embedded `assets/product-demo.gif`. GIF rendering requires `ffmpeg`.

## License

[MIT](LICENSE)
