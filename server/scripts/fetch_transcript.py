"""
fetch_transcript.py
Fetches a YouTube transcript using youtube-transcript-api v1.x
Usage: python fetch_transcript.py <videoId> [lang]
Output: JSON { "text": "..." }  on stdout
        JSON { "error": "..." } on stderr + exit 1
"""

import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: fetch_transcript.py <videoId> [lang]"}), file=sys.stderr)
        sys.exit(1)

    video_id = sys.argv[1]
    preferred_lang = sys.argv[2] if len(sys.argv) > 2 else "en"

    try:
        from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
        api = YouTubeTranscriptApi()

        try:
            transcript_list = api.list(video_id)
        except Exception as e:
            raise Exception(f"Could not retrieve transcripts for video: {str(e)}")

        # Try preferred language list first, then fallback to any available
        lang_priority = [preferred_lang, "en", "en-US", "en-GB", "en-IN"]
        # Remove duplicates while preserving order
        seen = set()
        lang_list = [x for x in lang_priority if not (x in seen or seen.add(x))]

        transcript_data = None
        
        try:
            transcript_obj = transcript_list.find_transcript(lang_list)
            transcript_data = transcript_obj.fetch()
        except:
            pass

        # If preferred specific langs failed, fallback to any manual or auto-generated
        if transcript_data is None:
            manual_transcripts = [t for t in transcript_list if not t.is_generated]
            if manual_transcripts:
                transcript_data = manual_transcripts[0].fetch()
            else:
                auto_transcripts = [t for t in transcript_list if t.is_generated]
                if auto_transcripts:
                    transcript_data = auto_transcripts[0].fetch()

        if transcript_data is None:
            all_transcripts = list(transcript_list)
            if all_transcripts:
                transcript_data = all_transcripts[0].fetch()
            else:
                raise Exception("No transcript available in any language")

        # FetchedTranscript is iterable; each item might have .text attribute (v1.x) or behave as dict
        try:
            text = " ".join(snippet.text for snippet in transcript_data)
        except AttributeError:
            # Fallback for older structure (dict-like)
            text = " ".join(
                s.get("text", "") if isinstance(s, dict) else getattr(s, "text", "")
                for s in transcript_data
            )

        if not text or len(text.strip()) < 20:
            raise Exception("Transcript is empty or too short")

        # Output as JSON (ensure ASCII-safe for Windows cp1252 terminals)
        print(json.dumps({"text": text}, ensure_ascii=True))

    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=True), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
