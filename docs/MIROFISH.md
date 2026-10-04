# How to turn MiroFish on

MiroFish is a separate toy town. Envelope is the desk. The desk can knock on the town's door. It cannot build the town by itself.

The town remembers people in a notebook called Zep. The town thinks with a model key you give it. Envelope does not keep those two keys.

## Do these in order

1. On your computer, download the MiroFish program from github.com/666ghj/MiroFish.
2. Open its folder.
3. Copy the example settings file to a file named `.env`.
4. Type your model key on the `LLM_API_KEY` line. If you use Grok, the address line is `https://api.x.ai/v1` and the model line is the model name xAI gave you.
5. Type your Zep key on the `ZEP_API_KEY` line. Get that key from zep cloud. There is no key inside the download.
6. Run the setup command from the MiroFish readme (`npm run setup:all`).
7. Run the start command (`npm run dev`).
8. Leave that window open. The town listens on port 5001. The picture window is port 3000.
9. Envelope already knocks on port 5001. You do not paste the Zep key into Envelope.

When the town is off, Envelope keeps trading on the tape. It does not make up a crowd percentage.
