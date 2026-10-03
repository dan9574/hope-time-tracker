import HopeCore
import SwiftUI

/// The two-level activity choice (rebuild-plan 10 C): a top-level activity is picked with a tap; one with
/// sub-activities opens them, and the parent itself is the first choice there. For use inside a `List`
/// whose `NavigationStack` handles `ActivityNodeRoute`.
struct ActivityRows: View {
    var tree: [ActivityNode]
    var onPick: (String) -> Void

    var body: some View {
        ForEach(tree) { node in
            if node.children.isEmpty {
                Button { onPick(node.activity.id) } label: {
                    ActivityLabel(name: node.activity.name, color: node.activity.palette)
                }
            } else {
                NavigationLink(value: ActivityNodeRoute(id: node.activity.id)) {
                    ActivityLabel(name: node.activity.name, color: node.activity.palette)
                }
            }
        }
    }
}

struct ActivityNodeRoute: Hashable {
    var id: String
}

/// The sub-activities of one parent, with the parent itself first.
struct ChildActivityList: View {
    var node: ActivityNode
    var onPick: (String) -> Void

    var body: some View {
        List {
            Button { onPick(node.activity.id) } label: {
                ActivityLabel(name: node.activity.name, color: node.activity.palette)
            }
            Section {
                ForEach(node.children) { child in
                    Button { onPick(child.id) } label: {
                        ActivityLabel(name: child.name, color: node.activity.palette)
                    }
                }
            }
        }
        .navigationTitle(Text(verbatim: node.activity.name))
    }
}

/// Name + one of the eight palette colours. The only activity editing in this stage: without it a device
/// that has never synced would have nothing to time.
struct NewActivityView: View {
    var onAdd: (String, ActivityColor) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var color: ActivityColor = .blue

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Form {
            TextField("Activity name", text: $name)
            Section("Color") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 12) {
                    ForEach(ActivityColor.allCases, id: \.self) { c in
                        Button { color = c } label: {
                            ZStack {
                                Circle().fill(c.color).frame(width: 28, height: 28)
                                if c == color {
                                    Image(systemName: "checkmark")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(.black.opacity(0.7))
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(c.localizedName)
                        .accessibilityAddTraits(c == color ? .isSelected : [])
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("New Activity")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Add") {
                    onAdd(trimmed, color)
                    dismiss()
                }
                .disabled(trimmed.isEmpty)
            }
        }
    }
}
