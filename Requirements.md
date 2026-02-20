# curiosity  

this app is mean to take in two inputs: an image and a set of questions on that image. The set of questions can be either in text or markdown.

### Parameters: State, Level, and Detail

State: material generated from the app will be aligned with state standards for that State (e.g., Florida, Texas, California, New York). Default state for this app: Florida.

Level: the level (elementary, middle, high [school] or advanced)

Detail: the amount of detail in the answer. This correlates with length and also with the number of subject indicated in an answer. This can be 3 values (low, medium, high).

### Process

The interface is web based, and so Javascript, CSS, and HTML. LLM model access will use openrouter, and the API Key for OpenRouter is located in ~/.env if an environment variable is defined in ~/.env or at the operating system level, then the app has the necessary authorization. If there is no such variable, there will be a pop-up asking the user to entere the API Key for OpenRouter.

The interface of the app gets two inputs: an image which is either dragged and dropped or selected via a file explorer, and a set of questions either typed in, copy and pasted, or via a file (typically, text file or markdown)

The app will take the parameters and the set of questions. This question will have a coordinator LLM, which can be set by the user. And there will be 3 LLMs that are the workers. The level of answer is taken into account, and will be handled by the coordinator and workers. Also, the detail will be taken into account. The intial LLM workers will be the latest Google Gemini, OpenAI, and Anthropic detailed thinking models. For Gemini, it is Gemini 3.1 Pro (thinking mode). If this Gemini model is not yet in OpenRouter, use Gemini 3 Pro. For OpenAI, ChatGPT 5.2 Thinking, and for Anthropic, Claude 4.6 Opus. By default, the coordinator will be Claude 4.6 Opus. Later, we may have this optional in the interface.

 The question is posed to the coordinator and then passed to the workers. The coordinator will take each separate worker feedback and coordinate into a comprehensive answer. Some worker feedback will be similar and so this can be synthesized, and differing feedback is aggregated in the final answer.

Answers should contain one or more subjects that are deemed to align with the question. For example, an image is of a painting with a blue sky. "Why is the sky blue" will have an answer depending on level, but also on detail. Simple detail and, say, a high school level may result in subject: physics (Rayleigh scattering) being identified along with a corresponding answer. However, a more detailed answer might identify other subjects such as meteorology (type of sky, moisture, pollutants), art(artist approaches in choosing color pigment or paint), and language (etymology of color words or semiotics). More detailed answers will generate more subject-specific responses.

At the end of a question-answer pair, there will be state school alignments in a way done similar to PBS: https://florida.pbslearningmedia.org/resource/ The idea is to align a question with one or more subjects, and then to have a section enabling schools to align subjects with level and state/national standard. For national, we assume United States for this app. For state, we default to Florida if none selected. This material will be at the end just as it shows in the PBS learning media web pages.

Results will be issued in the HTML document, but there should be an option to produce either Markdown or PDF text of the entire report. The report should have exact text that is shown in the web page.

### Summary

This app operationalizes curiosity based on the idea of questions being at the heart of curiosity. The more questions, the more curiosity is pronounced. Having an image anchors curiosity. Each question will be addressed by academic level and also level of detail. Answers are prefixed by one or more subject identifiers along with text obtained by the coordinator in concert with the three workers. The subject idea is  also instrumented in ~/deeplooking in tabs that appear in popup boxes.

Optionally, some of the outputs of the process described can be used as input to the DeepLooking app ~/deeplooking so that new entries can be made to the gallery. For the time being, this is optional and do not work on any specific.

