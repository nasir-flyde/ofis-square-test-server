# Threaded Comments Feature - Implementation Plan

## Overview
Implement a thread/reply feature for comments in the contract comments panel, allowing users to reply to existing comments and create threaded conversations.

## Current State Analysis

### Frontend
- **Location**: `ofis-square-frontend/src/components/pages/ContractDetailPage/CommentsPanel.jsx`
- **Current Structure**: Flat list of comments sorted by date
- **Comment Display**: Shows comment author, type, timestamp, context, and message
- **No Reply Functionality**: Currently, all comments are top-level

### Backend
- **Model**: `ofis-square/models/contractModel.js`
- **Current Schema**: Comments are stored as a flat array in the contract document
- **API Endpoint**: `POST /api/contracts/:id/comments`
- **No Parent/Reply Reference**: Comments don't have a `parentCommentId` or `replies` field

## Implementation Plan

### Phase 1: Backend Changes

#### 1.1 Update Comment Schema (contractModel.js)
**File**: `ofis-square/models/contractModel.js`

**Changes Required**:
- Add `parentCommentId` field (optional ObjectId reference to parent comment)
- Add `_id` field to comment subdocument (if not already present) for referencing
- Ensure comments can be nested (parent-child relationship)

**Schema Update**:
```javascript
comments: [
  {
    _id: { type: mongoose.Schema.Types.ObjectId, default: mongoose.Types.ObjectId },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    type: { type: String, enum: ["review", "internal", "client", "legal_only"], default: "internal" },
    message: { type: String, trim: true },
    mentionedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: "comments", default: null }, // NEW
    sectionType: { type: String, enum: ["general", "terms_section"], default: "general" },
    termsSection: { type: String, enum: [...] },
    paragraphIndex: { type: Number }
  }
]
```

#### 1.2 Update Comment API (contractController.js)
**File**: `ofis-square/controllers/contractController.js`

**Changes Required**:
- Modify `addComment` function to accept `parentCommentId` parameter
- Validate that parent comment exists and belongs to the same contract
- Ensure reply inherits context from parent (sectionType, termsSection, etc.)
- Add validation to prevent circular references

**New API Behavior**:
```javascript
// POST /api/contracts/:id/comments
{
  message: "Reply text",
  type: "internal",
  parentCommentId: "comment_id_here", // NEW - optional
  mentionedUsers: [],
  // ... other fields
}
```

**Validation Rules**:
- If `parentCommentId` is provided, validate it exists in contract.comments
- Reply should inherit `sectionType`, `termsSection`, `paragraphIndex` from parent
- Reply `type` should match parent `type` (or allow override with permission check)

#### 1.3 Add Helper Functions
**New Functions Needed**:
- `getCommentThread(commentId, allComments)` - Get a comment and all its replies recursively
- `buildCommentTree(comments)` - Build a tree structure from flat comment array
- `validateParentComment(contract, parentCommentId)` - Validate parent exists

#### 1.4 Update Comment Retrieval
**File**: `ofis-square/controllers/contractController.js`

**Changes Required**:
- Modify `getContractById` to optionally return comments in tree structure
- Add endpoint to get comment thread: `GET /api/contracts/:id/comments/:commentId/thread`
- Ensure replies are populated with user information

### Phase 2: Frontend Changes

#### 2.1 Update CommentsPanel Component
**File**: `ofis-square-frontend/src/components/pages/ContractDetailPage/CommentsPanel.jsx`

**New State Variables**:
```javascript
const [replyingTo, setReplyingTo] = useState(null); // Comment ID being replied to
const [replyText, setReplyText] = useState(""); // Reply input text
const [expandedThreads, setExpandedThreads] = useState(new Set()); // Track expanded threads
```

**New Functions Needed**:
- `handleReply(comment)` - Open reply input for a comment
- `handleSubmitReply(parentCommentId)` - Submit reply to parent comment
- `buildCommentTree(comments)` - Convert flat array to tree structure
- `renderCommentThread(comment, depth)` - Recursively render comment and replies
- `toggleThread(commentId)` - Expand/collapse thread

#### 2.2 Update Comment Display UI
**Changes Required**:
- Add "Reply" button to each comment
- Show reply count badge on comments with replies
- Indent replies visually (nested structure)
- Add expand/collapse functionality for threads
- Show "Replying to @username" indicator in reply input
- Display thread depth with visual indicators (lines, indentation)

**UI Components**:
- Reply button (MessageSquare or Reply icon)
- Reply input form (appears below comment when replying)
- Thread indicator (vertical line connecting parent to replies)
- Expand/collapse button for threads with multiple replies

#### 2.3 Update Comment Rendering
**Changes Required**:
- Transform flat comment array to tree structure
- Render top-level comments first
- Render replies nested under parent comments
- Apply visual hierarchy (indentation, borders, background colors)
- Show reply count: "3 replies" badge
- Add "View replies" / "Hide replies" toggle

**Visual Design**:
```
┌─────────────────────────────────────┐
│ [User] Comment text...              │
│ [Reply] [3 replies ▼]               │
│   └─ [User] Reply 1...              │
│      [Reply]                         │
│   └─ [User] Reply 2...              │
│      [Reply] [1 reply ▼]            │
│        └─ [User] Nested reply...    │
└─────────────────────────────────────┘
```

#### 2.4 Update Add Comment Handler
**Changes Required**:
- Modify `handleAddComment` to accept optional `parentCommentId`
- When replying, inherit context from parent comment
- Clear reply form after submission
- Refresh comment list to show new reply

### Phase 3: Additional Features

#### 3.1 Notification System
- Notify parent comment author when someone replies
- Include reply context in notification
- Support email notifications for replies

#### 3.2 Thread Management
- Mark thread as resolved/closed
- Pin important threads
- Search within threads
- Filter by thread depth

#### 3.3 Permissions
- Ensure reply permissions match parent comment permissions
- Legal-only comments can only be replied to by legal team
- Internal comments can only be replied to by mentioned users or admins

### Phase 4: Testing & Validation

#### 4.1 Backend Testing
- Test creating top-level comments (no parent)
- Test creating replies (with parent)
- Test nested replies (reply to a reply)
- Test validation (invalid parent, circular reference)
- Test comment inheritance (context, type)
- Test comment filtering with threads

#### 4.2 Frontend Testing
- Test reply UI interaction
- Test thread expansion/collapse
- Test nested reply rendering
- Test reply submission
- Test visual hierarchy
- Test mobile responsiveness

#### 4.3 Integration Testing
- Test full reply flow (create → display → reply → refresh)
- Test permissions with replies
- Test comment filtering with threads
- Test activity logging for replies

## Implementation Steps

### Step 1: Backend Schema Update
1. Update `contractModel.js` to add `parentCommentId` field
2. Add `_id` field to comment subdocument if missing
3. Test schema migration (existing comments should work)

### Step 2: Backend API Update
1. Update `addComment` function to handle `parentCommentId`
2. Add validation for parent comment
3. Add helper functions for comment tree building
4. Test API endpoints

### Step 3: Frontend State Management
1. Add state variables for reply functionality
2. Add helper functions for tree building
3. Update comment data structure handling

### Step 4: Frontend UI Components
1. Add Reply button to comment display
2. Add reply input form component
3. Add thread visualization (indentation, lines)
4. Add expand/collapse functionality

### Step 5: Integration
1. Connect reply form to API
2. Update comment list rendering
3. Test full user flow
4. Add error handling

### Step 6: Polish & Enhancements
1. Add animations for thread expansion
2. Add reply count badges
3. Add keyboard shortcuts (Esc to cancel reply)
4. Improve mobile experience

## Data Migration

### Existing Comments
- All existing comments will have `parentCommentId: null`
- No migration needed - backward compatible
- Existing comments remain top-level

## API Changes Summary

### New Request Body Field
```javascript
POST /api/contracts/:id/comments
{
  // ... existing fields
  parentCommentId: "optional_comment_id" // NEW
}
```

### Response Structure
```javascript
{
  success: true,
  data: {
    _id: "comment_id",
    parentCommentId: "parent_id_or_null",
    // ... other fields
  }
}
```

## UI/UX Considerations

1. **Visual Hierarchy**: Clear indentation and visual lines to show parent-child relationships
2. **Reply Indicators**: Show "Replying to @username" in reply input
3. **Thread Depth**: Limit visual nesting depth (e.g., max 3-4 levels)
4. **Performance**: Lazy load replies for threads with many replies
5. **Accessibility**: Proper ARIA labels for screen readers
6. **Mobile**: Collapsible threads for better mobile experience

## Security Considerations

1. **Permission Inheritance**: Replies inherit parent comment permissions
2. **Validation**: Ensure parent comment belongs to same contract
3. **Access Control**: Users can only reply if they can view parent comment
4. **Type Matching**: Reply type should match parent (or require permission)

## Future Enhancements

1. **Thread Actions**: Resolve, pin, archive threads
2. **Rich Text**: Support markdown/formatting in replies
3. **File Attachments**: Attach files to replies
4. **Reactions**: Like/react to comments and replies
5. **Mentions in Replies**: Auto-mention parent comment author
6. **Thread Search**: Search within specific threads
7. **Export Threads**: Export conversation threads

## Estimated Timeline

- **Phase 1 (Backend)**: 2-3 days
- **Phase 2 (Frontend)**: 3-4 days
- **Phase 3 (Additional Features)**: 2-3 days
- **Phase 4 (Testing)**: 1-2 days
- **Total**: ~8-12 days

## Dependencies

- No new external dependencies required
- Uses existing React, Mongoose, and API infrastructure
- May need to update UI component library if adding new icons

## Risk Assessment

### Low Risk
- Schema changes are backward compatible
- Existing comments remain functional
- Can be feature-flagged for gradual rollout

### Medium Risk
- UI complexity with nested rendering
- Performance with deeply nested threads
- Permission inheritance logic

### Mitigation
- Add depth limits for nesting
- Implement pagination for long threads
- Thorough testing of permission logic
- Feature flag for gradual rollout


