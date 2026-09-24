import type { AnswerValue, QuestionDefinition, QuestionnaireSection, VisibleWhen } from "./types.ts";

/**
 * Academy 2026 booth questionnaire.
 * Keep ids stable once inquiries have been saved: the id is stored with each answer.
 *
 * Supported types: short-text, long-text, single-select, multi-select, yes-no.
 */
export const questionnaireSections: QuestionnaireSection[] = [
  {
    id: "visit",
    title: "Primary Reason for Visit Today",
    questions: [
      {
        id: "visit_reason",
        label: "Primary area of interest? (Check all that apply)",
        type: "multi-select",
        required: false,
        options: [
          "Book Inquiry / Request",
          "EVOQ Technologies Product Lines",
          "General Information / Exploring Options",
          "Other (Please specify)",
        ],
      },
      {
        id: "visit_reason_other",
        label: "Other reason for visit",
        type: "short-text",
        required: false,
        placeholder: "Please specify",
        attachTo: { questionId: "visit_reason", option: "Other (Please specify)" },
      },
    ],
  },
  {
    id: "book",
    title: "Book Information & Ordering",
    questions: [
      {
        id: "book_interest",
        label: "Book Information & Ordering",
        type: "multi-select",
        required: false,
        options: [
          "General inquiry / Questions",
          "Receive a complimentary copy",
          "Information on how to order additional copies / bulk orders",
        ],
      },
    ],
  },
  {
    id: "products",
    title: "Product Line Interest",
    questions: [
      {
        id: "product_interest",
        label: "Which EVOQ Technologies products are you interested in learning more about? (Check all that apply)",
        type: "multi-select",
        required: false,
        options: [
          "Twilight Dark Adaptometer",
          "SmartERG",
          "Dark Adaptation Pod",
          "Other EVOQ Technologies Product / Solution",
        ],
      },
      {
        id: "product_interest_other",
        label: "Other EVOQ Technologies product or solution",
        type: "short-text",
        required: false,
        placeholder: "Product or solution",
        attachTo: { questionId: "product_interest", option: "Other EVOQ Technologies Product / Solution" },
      },
    ],
  },
  {
    id: "dark_adaptation",
    title: "Dark Adaptation Testing in Practice",
    questions: [
      {
        id: "dark_adaptation_current",
        label: "Do you currently conduct dark adaptation testing in your practice?",
        type: "yes-no",
        required: false,
      },
      {
        id: "dark_adaptation_system",
        label: "If Yes, what system or method are you currently using?",
        type: "long-text",
        required: false,
        placeholder: "System or method",
        visibleWhen: { questionId: "dark_adaptation_current", equals: true },
      },
      {
        id: "dark_adaptation_adding",
        label: "If No, are you actively looking to add dark adaptation testing to your practice?",
        type: "single-select",
        required: false,
        options: ["Yes", "No", "Undecided / Evaluating potential benefits"],
        visibleWhen: { questionId: "dark_adaptation_current", equals: false },
      },
    ],
  },
  {
    id: "next_steps",
    title: "Product Demo & Next Steps",
    description: "Are you interested in scheduling a future product demonstration or follow-up?",
    questions: [
      {
        id: "twilight_next",
        label: "Twilight Dark Adaptometer Demo / Follow-Up",
        type: "multi-select",
        required: false,
        options: [
          "Provide quote",
          "Schedule a live or virtual demo",
          "Send clinical/product literature",
          "Interested in conducting research",
        ],
      },
      {
        id: "other_product_next",
        label: "Other Product Demos (SmartERG, Dark Adaptation Pod, etc.)",
        type: "multi-select",
        required: false,
        options: [
          "Provide quote",
          "Schedule a live or virtual demo",
          "Send clinical/product literature",
          "Interested in conducting research",
        ],
      },
    ],
  },
  {
    id: "timeline",
    title: "Implementation & Purchase Timeline",
    questions: [
      {
        id: "purchase_timeline",
        label: "What is your anticipated timeline for evaluating or acquiring new equipment/products?",
        type: "single-select",
        required: false,
        options: [
          "Immediate (Within 30 days)",
          "1 – 3 Months",
          "3 – 6 Months",
          "6 – 12 Months",
          "12+ Months / Information Gathering Only",
        ],
      },
    ],
  },
  {
    id: "comments",
    title: "Additional Comments & Specific Questions",
    questions: [
      {
        id: "additional_comments",
        label: "Please let us know if you have any specific requirements, clinical questions, or notes for our team:",
        type: "long-text",
        required: false,
        placeholder: "Requirements, clinical questions, or notes",
      },
    ],
  },
];

export const questionnaire: QuestionDefinition[] = questionnaireSections.flatMap((section) => section.questions);

export const formIntro = {
  title: "Booth Attendee Inquiry & Questionnaire Form",
  body: "Thank you for visiting the EVOQ Technologies booth at Academy 2026! Please answer the questions below to help us assist you with information, product demonstrations, or book details.",
};

function answerFor(answers: Map<string, AnswerValue | undefined> | Record<string, AnswerValue | undefined>, id: string) {
  return answers instanceof Map ? answers.get(id) : answers[id];
}

export function visibilityRule(question: QuestionDefinition): VisibleWhen | undefined {
  if (question.visibleWhen) return question.visibleWhen;
  if (question.attachTo) return { questionId: question.attachTo.questionId, includes: question.attachTo.option };
  return undefined;
}

export function isQuestionVisible(
  question: QuestionDefinition,
  answers: Map<string, AnswerValue | undefined> | Record<string, AnswerValue | undefined>,
): boolean {
  const rule = visibilityRule(question);
  if (!rule) return true;
  const value = answerFor(answers, rule.questionId);
  if (rule.includes !== undefined) return Array.isArray(value) && value.includes(rule.includes);
  if (rule.equals !== undefined) return value === rule.equals;
  return true;
}
